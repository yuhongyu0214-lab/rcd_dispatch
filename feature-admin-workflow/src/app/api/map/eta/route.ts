import { type NextRequest } from "next/server";

import { drivingRoute } from "@/lib/amap";
import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getDriverLocation } from "@/lib/redis";

export const dynamic = "force-dynamic";

const etaLog = createLogger("map-eta");

/**
 * GET /api/map/eta?orderId=X&driverId=Y
 *
 * 调用高德驾车路径规划 API，返回司机到订单取车点的真实 ETA。
 * 司机起点优先从 Redis 读取实时位置，回退到 DB lastLat/lastLng。
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("无权限", { status: 403, traceId });
  }

  const orderId = request.nextUrl.searchParams.get("orderId")?.trim();
  const driverId = request.nextUrl.searchParams.get("driverId")?.trim();

  if (!orderId) {
    return fail("请提供订单 ID", { status: 400, traceId });
  }

  if (!driverId) {
    return fail("请提供司机 ID", { status: 400, traceId });
  }

  try {
    // ── 1. 查订单目的地坐标 ──
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        pickupLat: true,
        pickupLng: true,
        pickupAddress: true,
      },
    });

    if (!order) {
      return fail("订单不存在", { status: 404, traceId });
    }

    if (order.pickupLat == null || order.pickupLng == null) {
      etaLog.warn("map_eta_no_destination", {
        traceId,
        orderId,
        driverId,
        reason: "订单取车坐标缺失",
      });
      return fail("订单取车坐标缺失，无法计算 ETA", { status: 400, traceId });
    }

    // ── 2. 获取司机起点坐标（Redis 优先 → DB 回退）──
    let driverLat: number | null = null;
    let driverLng: number | null = null;

    try {
      const redisLoc = await getDriverLocation(driverId);
      if (redisLoc?.lat && redisLoc?.lng) {
        driverLat = Number(redisLoc.lat);
        driverLng = Number(redisLoc.lng);
      }
    } catch {
      // Redis 不可用，静默回退 DB
    }

    if (driverLat == null || driverLng == null) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, lastLat: true, lastLng: true, isActive: true },
      });

      if (!driver || !driver.isActive) {
        return fail("司机不存在或已停用", { status: 404, traceId });
      }

      if (driver.lastLat != null && driver.lastLng != null) {
        driverLat = driver.lastLat;
        driverLng = driver.lastLng;
      }
    }

    if (driverLat == null || driverLng == null) {
      etaLog.warn("map_eta_no_origin", {
        traceId,
        orderId,
        driverId,
        reason: "司机位置缺失（Redis + DB 均无数据）",
      });
      return fail("司机位置缺失，请确认司机已上报 GPS", { status: 400, traceId });
    }

    // ── 3. 调用高德驾车路径规划 ──
    const route = await drivingRoute(
      { lat: driverLat, lng: driverLng },
      { lat: order.pickupLat, lng: order.pickupLng }
    );

    const etaMinutes = Math.ceil(route.duration / 60);

    etaLog.info("map_eta_calculated", {
      traceId,
      orderId,
      driverId,
      etaMinutes,
      distanceMeters: route.distance,
    });

    return ok(
      {
        orderId,
        driverId,
        etaMinutes,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        etaStatus: "NORMAL" as const,
        polyline: route.polyline ?? null,
        origin: { lat: driverLat, lng: driverLng },
        destination: { lat: order.pickupLat, lng: order.pickupLng },
      },
      { traceId }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ETA 计算失败";
    etaLog.error("map_eta_error", {
      traceId,
      orderId,
      driverId,
      error: message,
    });
    // 返回成功响应但标记 FAILED，让前端明确展示降级标识
    return ok(
      {
        orderId,
        driverId,
        etaMinutes: 0,
        distanceMeters: 0,
        durationSeconds: 0,
        etaStatus: "FAILED" as const,
        failReason: message,
      },
      { traceId }
    );
  }
}

import { fail, ok } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getDriverLocation } from "@/lib/redis";
import { buildNavigationUri } from "@/lib/amap";

import { extractDriverId } from "../_utils";

export const dynamic = "force-dynamic";

// ============================================================================
// 类型定义
// ============================================================================

type NavRequestBody = {
  orderId?: string;
  type?: string;
  driverId?: string;
};

const driverLog = createLogger("driver-workflow");

// ============================================================================
// POST /api/driver/nav — 司机获取导航 URI
// ============================================================================

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  // ---- 1. 鉴权 ----
  let driverId = extractDriverId(request);

  // ---- 2. 解析请求体 ----
  let body: NavRequestBody;
  try {
    body = (await request.json()) as NavRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  // 请求体中也可提供 driverId（与 JWT 配合或开发调试）
  if (!driverId) {
    driverId = body.driverId?.trim() ?? null;
  }

  if (!driverId) {
    return fail("请提供司机 ID（Authorization header 或请求体）", {
      status: 401,
      traceId
    });
  }

  // 校验 orderId
  const orderId = body.orderId?.trim();
  if (!orderId) {
    return fail("请提供订单 ID", { status: 400, traceId });
  }

  // 校验 type
  const type = body.type?.trim();
  if (!type || (type !== "pickup" && type !== "return")) {
    return fail("请提供有效的导航类型（pickup 或 return）", {
      status: 400,
      traceId
    });
  }

  // ---- 3. 获取司机位置 ----
  let driverLat: number | null = null;
  let driverLng: number | null = null;

  // 优先从 Redis 获取
  try {
    const redisLocation = await getDriverLocation(driverId);
    if (redisLocation?.lat && redisLocation?.lng) {
      driverLat = Number(redisLocation.lat);
      driverLng = Number(redisLocation.lng);
    }
  } catch {
    // Redis 不可用时降级到 DB
  }

  // Redis 未命中，回退到 DB
  if (driverLat === null || driverLng === null) {
    try {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, lastLat: true, lastLng: true, isActive: true }
      });

      if (!driver || !driver.isActive) {
        driverLog.warn("driver_nav_failed", {
          traceId,
          driverId,
          orderId,
          reason: "司机不存在或已停用"
        });
        return fail("司机不存在或已停用", { status: 404, traceId });
      }

      if (driver.lastLat != null && driver.lastLng != null) {
        driverLat = driver.lastLat;
        driverLng = driver.lastLng;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "数据库查询失败";
      driverLog.error("driver_nav_db_error", {
        traceId,
        driverId,
        orderId,
        error: message
      });
      return fail("服务暂时不可用", { status: 500, traceId });
    }
  }

  // ---- 4. 获取订单及派单信息 ----
  let order: {
    id: string;
    pickupLat: number | null;
    pickupLng: number | null;
    pickupAddress: string;
    returnLat: number | null;
    returnLng: number | null;
    returnAddress: string;
    currentAssignment: { driverId: string } | null;
  } | null;

  try {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        pickupLat: true,
        pickupLng: true,
        pickupAddress: true,
        returnLat: true,
        returnLng: true,
        returnAddress: true,
        currentAssignment: {
          select: { driverId: true }
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据库查询失败";
    driverLog.error("driver_nav_db_error", {
      traceId,
      driverId,
      orderId,
      error: message
    });
    return fail("服务暂时不可用", { status: 500, traceId });
  }

  // ---- 5. 校验订单与归属 ----
  if (!order) {
    return fail("订单不存在", { status: 404, traceId });
  }

  if (!order.currentAssignment) {
    return fail("该订单尚未派单", { status: 403, traceId });
  }

  if (order.currentAssignment.driverId !== driverId) {
    return fail("该任务不属于当前司机", { status: 403, traceId });
  }

  // ---- 6. 提取目标坐标 ----
  let targetLat: number | null;
  let targetLng: number | null;
  let targetAddress: string;

  if (type === "pickup") {
    targetLat = order.pickupLat;
    targetLng = order.pickupLng;
    targetAddress = order.pickupAddress;
  } else {
    targetLat = order.returnLat;
    targetLng = order.returnLng;
    targetAddress = order.returnAddress;
  }

  if (targetLat == null || targetLng == null) {
    return fail("目标地址坐标缺失，无法生成导航", { status: 400, traceId });
  }

  // ---- 7. 生成导航 URI ----
  const targetCoord = { lat: targetLat, lng: targetLng };
  const originCoord =
    driverLat != null && driverLng != null
      ? { lat: driverLat, lng: driverLng }
      : undefined;

  const navUri = buildNavigationUri(targetCoord, originCoord);

  // ---- 8. 日志与响应 ----
  const elapsed = Date.now() - startTime;

  driverLog.info("driver_nav_generated", {
    traceId,
    driverId,
    orderId,
    type,
    hasOrigin: String(originCoord != null),
    targetLat,
    targetLng,
    targetAddress,
    elapsed
  });

  return ok(
    {
      navUri,
      driverLat,
      driverLng,
      targetLat,
      targetLng,
      targetAddress
    },
    { traceId }
  );
}

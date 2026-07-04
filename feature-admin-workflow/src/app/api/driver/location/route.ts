import { fail, ok } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { setDriverLocation, setDriverOnline } from "@/lib/redis";

import {
  checkRateLimit,
  extractDriverId,
  isValidGCJ02Coordinate,
  parseCoordinate
} from "../_utils";

export const dynamic = "force-dynamic";

// ============================================================================
// 类型定义
// ============================================================================

type DriverLocationBody = {
  lat?: number | string;
  lng?: number | string;
  accuracy?: number | string;
  speed?: number | string;
  altitude?: number | string;
  direction?: number | string;
  provider?: string;
  timestamp?: number | string;
};

// ============================================================================
// 常量
// ============================================================================

/** 同一司机位置上报最小间隔（毫秒） */
const RATE_LIMIT_WINDOW_MS = 5_000;

/** 建议客户端下次上报间隔（毫秒），动态调速基准值 */
const NEXT_REPORT_INTERVAL_MS = 15_000;

/** Redis 位置数据 TTL（秒） */
const REDIS_LOCATION_TTL = 300;

const driverLog = createLogger("driver-workflow");

// ============================================================================
// POST /api/driver/location — 司机位置上报
// ============================================================================

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  // ---- 1. 鉴权 ----
  let driverId = extractDriverId(request);

  // ---- 2. 解析请求体 ----
  let body: DriverLocationBody;
  try {
    body = (await request.json()) as DriverLocationBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  // 请求体中也可提供 driverId（与 JWT 配合或开发调试）
  if (!driverId) {
    // 从请求体获取 driverId（兼容旧版调用）
    const bodyWithId = body as DriverLocationBody & { driverId?: string };
    driverId = bodyWithId.driverId?.trim() ?? null;
  }

  if (!driverId) {
    return fail("请提供司机 ID（Authorization header 或请求体）", {
      status: 401,
      traceId
    });
  }

  // ---- 3. 坐标解析与校验 ----
  const lat = parseCoordinate(body.lat);
  const lng = parseCoordinate(body.lng);

  if (lat === null || lng === null) {
    return fail("请提供合法经纬度", { status: 400, traceId });
  }

  if (!isValidGCJ02Coordinate(lat, lng)) {
    driverLog.warn("driver_location_invalid_coords", {
      traceId,
      driverId,
      lat,
      lng,
      reason: "坐标超出中国境内 GCJ02 范围 (lat:18-54, lng:73-136)"
    });
    return fail("坐标超出合法范围（中国境内 GCJ02：纬度 18-54，经度 73-136）", {
      status: 400,
      traceId
    });
  }

  // ---- 4. 频率限制 ----
  if (!checkRateLimit(`loc:${driverId}`, RATE_LIMIT_WINDOW_MS)) {
    driverLog.warn("driver_location_rate_limited", {
      traceId,
      driverId,
      windowMs: RATE_LIMIT_WINDOW_MS
    });
    return fail("上报过于频繁，请稍后再试", { status: 429, traceId });
  }

  // ---- 5. 解析可选字段 ----
  const accuracy = body.accuracy != null ? Number(body.accuracy) : undefined;
  const speed = body.speed != null ? Number(body.speed) : undefined;
  const altitude = body.altitude != null ? Number(body.altitude) : undefined;
  const direction = body.direction != null ? Number(body.direction) : undefined;
  const provider = body.provider?.trim() || undefined;
  const clientTs = body.timestamp != null ? Number(body.timestamp) : Date.now();
  const serverTs = Date.now();

  // ---- 6. 校验司机存在性 ----
  let redisDegraded = false;

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, isActive: true }
    });

    if (!driver || !driver.isActive) {
      driverLog.warn("driver_location_failed", {
        traceId,
        driverId,
        reason: "司机不存在或已停用"
      });
      return fail("司机不存在或已停用", { status: 404, traceId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据库查询失败";
    driverLog.error("driver_location_db_error", {
      traceId,
      driverId,
      error: message
    });
    return fail("服务暂时不可用", { status: 500, traceId });
  }

  // ---- 7. 写入 Redis（不阻塞） ----
  const locationData = {
    lat: String(lat),
    lng: String(lng),
    accuracy: accuracy != null ? String(accuracy) : undefined,
    speed: speed != null ? String(speed) : undefined,
    altitude: altitude != null ? String(altitude) : undefined,
    direction: direction != null ? String(direction) : undefined,
    loc_type: provider,
    ts: String(clientTs),
    server_ts: String(serverTs),
    status: "ACTIVE"
  };

  // 并行写入 Redis（不阻塞响应）
  const redisLocationPromise = setDriverLocation(driverId, locationData).catch(
    () => {
      redisDegraded = true;
    }
  );
  const redisOnlinePromise = setDriverOnline(driverId).catch(() => {
    redisDegraded = true;
  });

  // ---- 8. 异步更新 Driver 表（不阻塞响应） ----
  const dbUpdatePromise = prisma.driver
    .update({
      where: { id: driverId },
      data: {
        lastLat: lat,
        lastLng: lng,
        lastOnlineAt: new Date(serverTs)
      }
    })
    .catch((error) => {
      driverLog.warn("driver_location_db_update_failed", {
        traceId,
        driverId,
        error: String(error)
      });
    });

  // ---- 9. 等待 Redis 写入完成以判断降级状态 ----
  try {
    await Promise.allSettled([redisLocationPromise, redisOnlinePromise]);
  } catch {
    // 已通过 catch 标记降级
  }

  if (redisDegraded) {
    driverLog.warn("driver_location_redis_degraded", {
      traceId,
      driverId,
      action: "location_report",
      reason: "Redis 不可用，已降级为仅更新数据库"
    });
  }

  // ---- 10. 日志与响应 ----
  const elapsed = Date.now() - startTime;

  driverLog.info("driver_location_received", {
    traceId,
    driverId,
    lat,
    lng,
    accuracy: accuracy ?? null,
    speed: speed ?? null,
    provider: provider ?? "unknown",
    redisAvailable: !redisDegraded,
    elapsed
  });

  return ok(
    {
      driverId,
      lat,
      lng,
      serverTs,
      nextReportIntervalMs: NEXT_REPORT_INTERVAL_MS
    },
    { traceId }
  );
}

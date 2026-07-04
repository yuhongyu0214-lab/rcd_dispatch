import crypto from "crypto";

import type { Prisma } from "@prisma/client";

import { ADMIN_ROLES } from "@/lib/auth/roles";

// ============================================================================
// 坐标校验 — GCJ02 中国境内范围
// ============================================================================

/** GCJ02 中国境内合法坐标范围 */
const GCJ02_BOUNDS = {
  latMin: 18,
  latMax: 54,
  lngMin: 73,
  lngMax: 136
} as const;

/**
 * 校验 GCJ02 坐标是否在中国境内合法范围内。
 * 返回 true 表示坐标合法。
 */
export function isValidGCJ02Coordinate(lat: number, lng: number): boolean {
  return (
    lat >= GCJ02_BOUNDS.latMin &&
    lat <= GCJ02_BOUNDS.latMax &&
    lng >= GCJ02_BOUNDS.lngMin &&
    lng <= GCJ02_BOUNDS.lngMax
  );
}

// ============================================================================
// 频率限制 — 滑动窗口（进程内存）
// ============================================================================

const rateLimitMap = new Map<string, number>();

/** 定期清理过期的限流记录，避免内存泄漏 */
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanupRateLimitMap() {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  // 清理超过 30 秒的记录
  for (const [key, ts] of rateLimitMap) {
    if (now - ts > 30_000) {
      rateLimitMap.delete(key);
    }
  }
}

/**
 * 滑动窗口频率限制。
 * 返回 true 表示允许通过，false 表示触发限流。
 */
export function checkRateLimit(key: string, windowMs: number): boolean {
  cleanupRateLimitMap();

  const now = Date.now();
  const lastTime = rateLimitMap.get(key);

  if (lastTime !== undefined && now - lastTime < windowMs) {
    return false;
  }

  rateLimitMap.set(key, now);
  return true;
}

// ============================================================================
// JWT 鉴权 — HMAC-SHA256 验证（无外部依赖）
// ============================================================================

function base64UrlDecode(str: string): string {
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

interface DriverTokenPayload {
  sub: string; // driverId
  exp?: number;
  iat?: number;
}

/**
 * 验证司机 JWT token（HMAC-SHA256）。
 * 成功返回 payload，失败返回 null。
 * 开发环境下跳过签名验证（仅解析 payload）。
 */
export function verifyDriverToken(token: string): DriverTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(base64UrlDecode(parts[1])) as DriverTokenPayload;

    if (!payload.sub || typeof payload.sub !== "string") return null;

    // 过期检查
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    // 生产环境验证签名
    if (process.env.NODE_ENV === "production") {
      const secret =
        process.env.DRIVER_JWT_SECRET ||
        process.env.NEXTAUTH_SECRET ||
        "dispatch-driver-secret";
      const signature = crypto
        .createHmac("sha256", secret)
        .update(`${parts[0]}.${parts[1]}`)
        .digest("base64url");

      if (signature !== parts[2]) return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * 从请求中提取并验证 driverId。
 * 优先从 Authorization header (Bearer token) 提取，
 * 其次从 query params 提取（开发调试用）。
 * 返回 driverId 或 null。
 */
export function extractDriverId(request: Request): string | null {
  // 1. JWT Bearer token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const payload = verifyDriverToken(token);
    if (payload) return payload.sub;
  }

  // 2. Query param / body fallback（仅开发环境）
  if (process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(request.url);
      const queryId = url.searchParams.get("driverId")?.trim();
      if (queryId) return queryId;
    } catch {
      // URL 解析失败，忽略
    }
  }

  return null;
}

// ============================================================================
// 司机任务 DTO
// ============================================================================

type DriverTaskOrder = Prisma.OrderGetPayload<{
  include: {
    store: { select: { id: true; name: true; code: true } };
    vehicle: { select: { id: true; licensePlate: true; vehicleType: true } };
    currentAssignment: {
      include: {
        driver: { select: { id: true; name: true; phone: true; status: true } };
      };
    };
  };
}>;

export type DriverTaskDTO = {
  taskId: string;
  orderNo: string;
  type: string;
  status: string;
  assignmentId: string;
  assignmentStatus: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  assignedAt: string;
  store: {
    id: string;
    code: string;
    name: string;
  };
  vehicle: {
    id: string | null;
    licensePlate: string | null;
    vehicleType: string | null;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    status: string;
  };
};

export function toDriverTaskDTO(order: DriverTaskOrder): DriverTaskDTO {
  const assignment = order.currentAssignment;

  return {
    taskId: order.id,
    orderNo: order.orderNo,
    type: order.type,
    status: order.status,
    assignmentId: assignment?.id ?? "",
    assignmentStatus: assignment?.status ?? "",
    pickupAddress: order.pickupAddress,
    returnAddress: order.returnAddress,
    scheduledAt: order.scheduledAt.toISOString(),
    assignedAt: assignment?.assignedAt?.toISOString() ?? order.createdAt.toISOString(),
    store: {
      id: order.store.id,
      code: order.store.code,
      name: order.store.name
    },
    vehicle: {
      id: order.vehicle?.id ?? null,
      licensePlate: order.vehicle?.licensePlate ?? order.licensePlateSnapshot,
      vehicleType: order.vehicle?.vehicleType ?? order.vehicleTypeSnapshot
    },
    driver: {
      id: assignment?.driver.id ?? "",
      name: assignment?.driver.name ?? "",
      phone: assignment?.driver.phone ?? "",
      status: assignment?.driver.status ?? ""
    }
  };
}

// ============================================================================
// 系统操作员
// ============================================================================

export async function resolveSystemOperatorUserId(tx: Prisma.TransactionClient) {
  const user = await tx.user.findFirst({
    where: { role: { in: [...ADMIN_ROLES] } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  return user?.id ?? null;
}

// ============================================================================
// 坐标解析
// ============================================================================

export function parseCoordinate(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

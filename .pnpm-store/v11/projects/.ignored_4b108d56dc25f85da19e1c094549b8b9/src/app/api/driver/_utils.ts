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

function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8").toString("base64url");
}

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

function getDriverJwtSecret(): string {
  return (
    process.env.DRIVER_JWT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dispatch-driver-secret"
  );
}

/**
 * 创建司机 JWT token（HMAC-SHA256）。
 * 用于 admin/dispatcher 关联司机后在小程序端认证，
 * 也用于登录接口返回 driverToken 给前端。
 */
export function createDriverToken(driverId: string): string {
  const secret = getDriverJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: DriverTokenPayload = {
    sub: driverId,
    iat: now,
    exp: now + 60 * 60 * 8 // 8 hours
  };
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
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
      const secret = getDriverJwtSecret();
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
 * 优先级：
 * 1. JWT Bearer token（小程序端标准流程）
 * 2. Web session cookie → 查找关联的 Driver（admin/dispatcher 同时是司机）
 * 3. Query param / body fallback（仅开发环境）
 * 返回 driverId 或 null。
 */
export async function extractDriverId(request: Request): Promise<string | null> {
  // 1. JWT Bearer token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const payload = verifyDriverToken(token);
    if (payload) return payload.sub;
  }

  // 2. Web session cookie → 查找关联 Driver（一人多角色支持）
  try {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const { AUTH_SESSION_COOKIE_NAME, verifySessionToken } = await import(
        "@/lib/auth/session"
      );
      const cookies = cookieHeader.split(";").map((c) => c.trim());
      const sessionCookie = cookies.find((c) =>
        c.startsWith(`${AUTH_SESSION_COOKIE_NAME}=`)
      );
      if (sessionCookie) {
        const token = sessionCookie.slice(AUTH_SESSION_COOKIE_NAME.length + 1);
        const session = verifySessionToken(token);
        if (session) {
          const { prisma } = await import("@/lib/prisma");
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { driverId: true }
          });
          if (user?.driverId) return user.driverId;
        }
      }
    }
  } catch {
    // Session 解析失败，继续其他方式
  }

  // 3. Query param / body fallback（仅开发环境）
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

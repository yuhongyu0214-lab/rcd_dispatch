import { timingSafeEqual } from "node:crypto";

import { amapHealthCheck } from "@/lib/amap";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { failV2, okV2 } from "@/lib/contracts/v2";
import { createApiErrorV2 } from "@/lib/contracts/v2/errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { redisHealthCheck } from "@/lib/redis";

export const dynamic = "force-dynamic";

const log = createLogger("readiness-api");

function matchesSecret(presented: string, configured: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const configuredBuffer = Buffer.from(configured);
  return (
    presentedBuffer.length === configuredBuffer.length &&
    timingSafeEqual(presentedBuffer, configuredBuffer)
  );
}

function getPresentedInternalSecret(request: Request): string {
  const explicitKey = request.headers.get("X-Internal-Key");
  if (explicitKey) return explicitKey;

  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
}

type ReadinessAuthorization = "authorized" | "unauthorized" | "forbidden";

async function authorizeReadiness(
  request: Request
): Promise<ReadinessAuthorization> {
  const configuredSecret = process.env.INTERNAL_CRON_SECRET?.trim() ?? "";
  const presentedSecret = getPresentedInternalSecret(request);
  if (
    configuredSecret &&
    presentedSecret &&
    matchesSecret(presentedSecret, configuredSecret)
  ) {
    return "authorized";
  }

  try {
    const user = await getCurrentUser();
    if (!user) return "unauthorized";
    return isAdminRole(user.role) ? "authorized" : "forbidden";
  } catch {
    return "unauthorized";
  }
}

async function databaseHealthCheck(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const authorization = await authorizeReadiness(request);
  if (authorization === "unauthorized") {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Readiness authentication required"),
      { traceId }
    );
  }
  if (authorization === "forbidden") {
    return failV2(
      createApiErrorV2("FORBIDDEN", "Readiness access is not allowed"),
      { traceId }
    );
  }

  const [dbReady, redisReady, amapReady] = await Promise.all([
    databaseHealthCheck(),
    redisHealthCheck(),
    amapHealthCheck()
  ]);
  const dependencies = {
    db: dbReady ? "ready" : "unavailable",
    redis: redisReady ? "ready" : "unavailable",
    amap: amapReady ? "ready" : "unavailable"
  } as const;

  if (!dbReady) {
    log.warn("readiness_dependency_unavailable", {
      traceId,
      dependency: "DATABASE"
    });
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Database readiness check failed"),
      { traceId }
    );
  }

  if (!redisReady) {
    log.warn("readiness_dependency_unavailable", {
      traceId,
      dependency: "REDIS"
    });
    return failV2(
      createApiErrorV2(
        "DEPENDENCY_UNAVAILABLE",
        "Redis readiness check failed",
        { dependency: "REDIS" }
      ),
      { traceId }
    );
  }

  if (!amapReady) {
    log.warn("readiness_dependency_unavailable", {
      traceId,
      dependency: "AMAP"
    });
    return failV2(
      createApiErrorV2(
        "DEPENDENCY_UNAVAILABLE",
        "Amap readiness check failed",
        { dependency: "AMAP" }
      ),
      { traceId }
    );
  }

  return okV2(
    {
      status: "ready" as const,
      dependencies
    },
    { traceId }
  );
}

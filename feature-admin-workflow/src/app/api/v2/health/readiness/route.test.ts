import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/amap", () => ({ amapHealthCheck: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() }
}));
vi.mock("@/lib/redis", () => ({ redisHealthCheck: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { amapHealthCheck } from "@/lib/amap";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { redisHealthCheck } from "@/lib/redis";

import { GET } from "./route";

const databaseProbe = prisma.$queryRaw as ReturnType<typeof vi.fn>;

function readinessRequest(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/v2/health/readiness", {
    headers: { "X-Trace-Id": "trace-readiness", ...headers }
  });
}

describe("GET /api/v2/health/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INTERNAL_CRON_SECRET", "worker-secret");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    databaseProbe.mockResolvedValue([{ '?column?': 1 }]);
    vi.mocked(redisHealthCheck).mockResolvedValue(true);
    vi.mocked(amapHealthCheck).mockResolvedValue(true);
  });

  it("rejects anonymous access without probing dependencies", async () => {
    const response = await GET(readinessRequest());

    expect(response.status).toBe(401);
    expect(databaseProbe).not.toHaveBeenCalled();
    expect(redisHealthCheck).not.toHaveBeenCalled();
    expect(amapHealthCheck).not.toHaveBeenCalled();
  });

  it("rejects an invalid internal credential", async () => {
    const response = await GET(
      readinessRequest({ Authorization: "Bearer wrong-secret" })
    );

    expect(response.status).toBe(401);
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("allows the internal system credential and reports all dependencies", async () => {
    const response = await GET(
      readinessRequest({ Authorization: "Bearer worker-secret" })
    );

    expect(response.status).toBe(200);
    expect(getCurrentUser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        status: "ready",
        dependencies: { db: "ready", redis: "ready", amap: "ready" }
      },
      traceId: "trace-readiness"
    });
  });

  it("allows a dispatcher session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "dispatcher-1",
      email: "dispatcher@example.invalid",
      name: "Dispatcher",
      role: "dispatcher",
      driverId: null
    });

    const response = await GET(readinessRequest());
    expect(response.status).toBe(200);
  });

  it("returns 403 for an authenticated non-dispatcher", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "driver-user-1",
      email: "driver@example.invalid",
      name: "Driver",
      role: "driver",
      driverId: "driver-1"
    });

    const response = await GET(readinessRequest());
    expect(response.status).toBe(403);
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure when the database is unavailable", async () => {
    databaseProbe.mockRejectedValue(new Error("secret database details"));

    const response = await GET(
      readinessRequest({ "X-Internal-Key": "worker-secret" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Database readiness check failed"
    });
    expect(JSON.stringify(body)).not.toContain("secret database details");
  });

  it("returns 503 with the failed Redis dependency", async () => {
    vi.mocked(redisHealthCheck).mockResolvedValue(false);

    const response = await GET(
      readinessRequest({ "X-Internal-Key": "worker-secret" })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        details: { dependency: "REDIS" }
      }
    });
  });

  it("returns 503 with the failed Amap dependency", async () => {
    vi.mocked(amapHealthCheck).mockResolvedValue(false);

    const response = await GET(
      readinessRequest({ "X-Internal-Key": "worker-secret" })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        details: { dependency: "AMAP" }
      }
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    driver: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    }
  },
  mockRedis: {
    getDriverLocation: vi.fn(),
    setDriverLocation: vi.fn(),
    setDriverOnline: vi.fn()
  }
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/redis", () => mockRedis);
vi.mock("@/lib/amap", () => ({
  buildNavigationUri: vi.fn(() => "amapuri://route/plan/")
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { POST as postLocation } from "./location/route";
import { POST as postNav } from "./nav/route";
import { POST as postAccept } from "./tasks/[id]/accept/route";
import { POST as postComplete } from "./tasks/[id]/complete/route";
import { GET as getTasks } from "./tasks/route";

describe("legacy driver routes authenticate before trusting request data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_DRIVER_ID", "true");
    vi.stubEnv("DRIVER_JWT_SECRET", "test-driver-secret-with-enough-entropy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects query driverId on the task list", async () => {
    const response = await getTasks(
      new Request("http://localhost/api/driver/tasks?driverId=attacker")
    );

    expect(response.status).toBe(401);
    expect(mockPrisma.driver.findUnique).not.toHaveBeenCalled();
  });

  it("rejects body driverId on accept", async () => {
    const response = await postAccept(
      new Request("http://localhost/api/driver/tasks/order-1/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "attacker" })
      }),
      { params: { id: "order-1" } }
    );

    expect(response.status).toBe(401);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects body driverId on complete", async () => {
    const response = await postComplete(
      new Request("http://localhost/api/driver/tasks/order-1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: "attacker" })
      }),
      { params: { id: "order-1" } }
    );

    expect(response.status).toBe(401);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects body driverId on navigation", async () => {
    const response = await postNav(
      new Request("http://localhost/api/driver/nav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: "attacker",
          orderId: "order-1",
          type: "pickup"
        })
      })
    );

    expect(response.status).toBe(401);
    expect(mockRedis.getDriverLocation).not.toHaveBeenCalled();
  });

  it("rejects body driverId on location reporting", async () => {
    const response = await postLocation(
      new Request("http://localhost/api/driver/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: "attacker",
          lat: 30.5,
          lng: 104
        })
      })
    );

    expect(response.status).toBe(401);
    expect(mockPrisma.driver.findUnique).not.toHaveBeenCalled();
  });
});

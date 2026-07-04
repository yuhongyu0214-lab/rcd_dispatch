import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

import { GET } from "./route";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    operationLog: {
      count: vi.fn(),
      findMany: vi.fn()
    }
  }
}));

function mockAdminUser() {
  vi.mocked(getCurrentUser).mockResolvedValue({
    email: "admin@dispatch.dev",
    id: "user-admin",
    name: "运营管理员",
    role: "admin",
    driverId: null
  });
}

describe("orders logs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminUser();
  });

  it("loads order operation logs in reverse chronological order", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(2);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        action: "REASSIGN",
        createdAt: new Date("2026-06-21T10:10:00.000Z"),
        entityId: "order-1",
        entityType: "ORDER",
        id: "log-new",
        metadataJson: { fromDriverId: "driver-old", toDriverId: "driver-new" },
        operatorUserId: "user-admin",
        reason: "司机临时不可用"
      },
      {
        action: "ASSIGN",
        createdAt: new Date("2026-06-21T10:00:00.000Z"),
        entityId: "order-1",
        entityType: "ORDER",
        id: "log-old",
        metadataJson: { driverId: "driver-old" },
        operatorUserId: "user-admin",
        reason: null
      }
    ]);
    vi.mocked(prisma.$transaction).mockImplementation(async (operations: unknown) =>
      Promise.all(operations as Array<Promise<unknown>>)
    );

    const response = await GET(
      new Request(
        "http://localhost/api/orders/logs?orderId=order-1&action=REASSIGN&limit=25"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(2);
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith({
      include: {
        operatorUser: { select: { email: true, id: true, name: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 25,
      where: {
        action: "REASSIGN",
        entityId: "order-1",
        entityType: "ORDER"
      }
    });
  });
});

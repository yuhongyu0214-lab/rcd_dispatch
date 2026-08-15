import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: { findFirst: vi.fn() },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/redis", () => ({
  acquireResourceLocks: vi.fn(),
  releaseResourceLock: vi.fn()
}));

vi.mock("@/lib/events/store", () => ({ enqueueInternalEvent: vi.fn() }));
vi.mock("@/lib/events/processor", () => ({ processInternalEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import { setDriverAvailability } from "./driver-command-service";

function transactionMock() {
  return {
    $queryRaw: vi.fn(),
    driver: { findFirst: vi.fn(), update: vi.fn() },
    assignment: { update: vi.fn() },
    order: { update: vi.fn() },
    operationLog: { create: vi.fn() }
  };
}

function runTransaction(tx: ReturnType<typeof transactionMock>) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
    callback(tx as never)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(acquireResourceLocks).mockImplementation(async (resources) =>
    new Map(resources.map(({ resourceKey }) => [resourceKey, "acquired"]))
  );
  vi.mocked(releaseResourceLock).mockResolvedValue();
  vi.mocked(enqueueInternalEvent).mockResolvedValue({
    eventId: "event-1",
    committed: true
  });
  vi.mocked(processInternalEvent).mockResolvedValue("processed");
  vi.mocked(prisma.driver.findFirst).mockResolvedValue({
    id: "driver-1",
    assignments: [{ orderId: "order-1" }]
  } as never);
});

describe("setDriverAvailability", () => {
  it("releases PLANNED assignments and commits one aggregate version and event", async () => {
    const tx = transactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      availability: "AVAILABLE",
      planVersion: 6,
      assignments: [
        {
          id: "assignment-1",
          orderId: "order-1",
          order: { currentAssignmentId: "assignment-1" }
        }
      ]
    });

    const result = await setDriverAvailability({
      driverId: "driver-1",
      availability: "UNAVAILABLE",
      reason: "临时停派",
      operatorUserId: "dispatcher-1",
      traceId: "trace-availability"
    });

    expect(result).toEqual({
      success: true,
      data: {
        driverId: "driver-1",
        availability: "UNAVAILABLE",
        planVersion: 7,
        releasedAssignmentIds: ["assignment-1"],
        replayed: false
      }
    });
    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: expect.objectContaining({
        status: "RECYCLED",
        sequenceNo: null,
        lockType: "NONE"
      })
    });
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { availability: "UNAVAILABLE", planVersion: 7 }
    });
    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventId: "driver-availability:driver-1:7",
        type: "DRIVER_AVAILABILITY_CHANGED",
        driverId: "driver-1",
        traceId: "trace-availability"
      })
    );
    expect(processInternalEvent).toHaveBeenCalledWith(
      "driver-availability:driver-1:7"
    );
  });

  it("replays an unchanged availability value with no side effects", async () => {
    const tx = transactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      availability: "AVAILABLE",
      planVersion: 6,
      assignments: []
    });

    const result = await setDriverAvailability({
      driverId: "driver-1",
      availability: "AVAILABLE",
      reason: "重复设置",
      operatorUserId: "dispatcher-1",
      traceId: "trace-replay"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        planVersion: 6,
        replayed: true,
        releasedAssignmentIds: []
      })
    });
    expect(tx.driver.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
  });

  it("falls back to database row locks when Redis is unavailable", async () => {
    vi.mocked(acquireResourceLocks).mockImplementation(async (resources) =>
      new Map(resources.map(({ resourceKey }) => [resourceKey, "unavailable"]))
    );
    const tx = transactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      availability: "UNAVAILABLE",
      planVersion: 2,
      assignments: []
    });

    const result = await setDriverAvailability({
      driverId: "driver-1",
      availability: "AVAILABLE",
      reason: "恢复派单",
      operatorUserId: "dispatcher-1",
      traceId: "trace-db-fallback"
    });

    expect(result.success).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(releaseResourceLock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND before acquiring locks", async () => {
    vi.mocked(prisma.driver.findFirst).mockResolvedValue(null);

    const result = await setDriverAvailability({
      driverId: "missing",
      availability: "UNAVAILABLE",
      reason: "停派",
      operatorUserId: "dispatcher-1",
      traceId: "trace-missing"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: "NOT_FOUND" })
    });
    expect(acquireResourceLocks).not.toHaveBeenCalled();
  });
});

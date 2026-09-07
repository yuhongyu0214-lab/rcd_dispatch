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
  it("releases a PLANNED assignment and emits an order-scoped event", async () => {
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
        eventId: "driver-availability:driver-1:7:assignment-1",
        type: "DRIVER_AVAILABILITY_CHANGED",
        driverId: "driver-1",
        orderId: "order-1",
        assignmentId: "assignment-1",
        traceId: "trace-availability"
      })
    );
    expect(processInternalEvent).toHaveBeenCalledWith(
      "driver-availability:driver-1:7:assignment-1"
    );
  });

  it("emits one scoped event per released cross-store order with one plan version change", async () => {
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({
      id: "driver-1",
      assignments: [{ orderId: "order-1" }, { orderId: "order-2" }]
    } as never);
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
        },
        {
          id: "assignment-2",
          orderId: "order-2",
          order: { currentAssignmentId: "assignment-2" }
        }
      ]
    });

    const result = await setDriverAvailability({
      driverId: "driver-1",
      availability: "UNAVAILABLE",
      reason: "跨门店停派",
      operatorUserId: "dispatcher-1",
      traceId: "trace-cross-store"
    });

    expect(result).toEqual({
      success: true,
      data: {
        driverId: "driver-1",
        availability: "UNAVAILABLE",
        planVersion: 7,
        releasedAssignmentIds: ["assignment-1", "assignment-2"],
        replayed: false
      }
    });
    expect(tx.driver.update).toHaveBeenCalledTimes(1);
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { availability: "UNAVAILABLE", planVersion: 7 }
    });
    expect(tx.operationLog.create).toHaveBeenCalledTimes(3);
    expect(
      tx.operationLog.create.mock.calls.filter(
        ([input]) => input.data.action === "AVAILABILITY_CHANGE"
      )
    ).toHaveLength(1);
    expect(enqueueInternalEvent).toHaveBeenCalledTimes(2);
    expect(enqueueInternalEvent).toHaveBeenNthCalledWith(1, tx, {
      eventId: "driver-availability:driver-1:7:assignment-1",
      type: "DRIVER_AVAILABILITY_CHANGED",
      driverId: "driver-1",
      orderId: "order-1",
      assignmentId: "assignment-1",
      occurredAt: expect.any(String),
      traceId: "trace-cross-store"
    });
    expect(enqueueInternalEvent).toHaveBeenNthCalledWith(2, tx, {
      eventId: "driver-availability:driver-1:7:assignment-2",
      type: "DRIVER_AVAILABILITY_CHANGED",
      driverId: "driver-1",
      orderId: "order-2",
      assignmentId: "assignment-2",
      occurredAt: expect.any(String),
      traceId: "trace-cross-store"
    });
    expect(processInternalEvent).toHaveBeenCalledTimes(2);
    expect(processInternalEvent).toHaveBeenNthCalledWith(
      1,
      "driver-availability:driver-1:7:assignment-1"
    );
    expect(processInternalEvent).toHaveBeenNthCalledWith(
      2,
      "driver-availability:driver-1:7:assignment-2"
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
    expect(enqueueInternalEvent).toHaveBeenCalledWith(tx, {
      eventId: "driver-availability:driver-1:3",
      type: "DRIVER_AVAILABILITY_CHANGED",
      driverId: "driver-1",
      occurredAt: expect.any(String),
      traceId: "trace-db-fallback"
    });
  });

  it.each(["operation log", "outbox"] as const)(
    "returns an internal error when the %s write aborts the availability transaction",
    async (failurePoint) => {
      const tx = transactionMock();
      runTransaction(tx);
      tx.driver.findFirst.mockResolvedValue({
        id: "driver-1",
        availability: "AVAILABLE",
        planVersion: 6,
        assignments: []
      });
      if (failurePoint === "operation log") {
        tx.operationLog.create.mockRejectedValue(new Error("log down"));
      } else {
        vi.mocked(enqueueInternalEvent).mockRejectedValue(
          new Error("outbox down")
        );
      }

      const result = await setDriverAvailability({
        driverId: "driver-1",
        availability: "UNAVAILABLE",
        reason: "事务失败验证",
        operatorUserId: "dispatcher-1",
        traceId: `trace-${failurePoint}-fail`
      });

      expect(result).toEqual({
        success: false,
        error: expect.objectContaining({ code: "INTERNAL_ERROR" })
      });
      expect(processInternalEvent).not.toHaveBeenCalled();
      if (failurePoint === "operation log") {
        expect(enqueueInternalEvent).not.toHaveBeenCalled();
      }
    }
  );

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

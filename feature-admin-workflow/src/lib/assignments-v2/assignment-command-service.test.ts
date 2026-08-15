import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findUnique: vi.fn() },
    order: { findUnique: vi.fn() },
    driver: { findFirst: vi.fn() },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/redis", () => ({
  acquireResourceLocks: vi.fn(),
  releaseResourceLock: vi.fn()
}));

vi.mock("@/lib/events/store", () => ({
  enqueueInternalEvent: vi.fn()
}));

vi.mock("@/lib/events/processor", () => ({
  processInternalEvent: vi.fn()
}));

vi.mock("@/lib/triggers/gate3-triggers", () => ({
  triggerAssignmentAssigned: vi.fn(),
  triggerAssignmentReassigned: vi.fn(),
  triggerAssignmentWithdrawn: vi.fn()
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { enqueueInternalEvent } from "@/lib/events/store";
import { processInternalEvent } from "@/lib/events/processor";
import { prisma } from "@/lib/prisma";
import {
  acquireResourceLocks,
  releaseResourceLock
} from "@/lib/redis";
import {
  triggerAssignmentAssigned,
  triggerAssignmentReassigned,
  triggerAssignmentWithdrawn
} from "@/lib/triggers/gate3-triggers";

import {
  assignOrder,
  executeDriverAssignmentAction,
  reassignAssignment,
  unlockAssignment,
  withdrawAssignment,
  type DriverExecutionAction
} from "./assignment-command-service";

type TransactionMock = ReturnType<typeof createTransactionMock>;

function createTransactionMock() {
  return {
    $queryRaw: vi.fn(),
    assignment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    order: { findUnique: vi.fn(), update: vi.fn() },
    driver: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    user: { findUnique: vi.fn() },
    operationLog: { create: vi.fn(), findFirst: vi.fn() }
  };
}

function runTransaction(tx: TransactionMock) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
    callback(tx as never)
  );
}

function mockAllLocks(result: "acquired" | "busy" | "unavailable") {
  vi.mocked(acquireResourceLocks).mockImplementation(async (resources) =>
    new Map(resources.map(({ resourceKey }) => [resourceKey, result]))
  );
}

function executionAssignment(
  executionStatus: "PLANNED" | "EN_ROUTE" | "IN_SERVICE" | "COMPLETED",
  planVersion = 5
) {
  return {
    id: "assignment-1",
    orderId: "order-1",
    driverId: "driver-1",
    status: executionStatus === "COMPLETED" ? "COMPLETED" : "ACTIVE",
    driver: { id: "driver-1", planVersion },
    order: {
      id: "order-1",
      currentAssignmentId: "assignment-1",
      executionStatus
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAllLocks("acquired");
  vi.mocked(releaseResourceLock).mockResolvedValue();
  vi.mocked(enqueueInternalEvent).mockResolvedValue({
    eventId: "event-1",
    committed: true
  });
  vi.mocked(processInternalEvent).mockResolvedValue({ processed: true } as never);
  vi.mocked(triggerAssignmentAssigned).mockResolvedValue();
  vi.mocked(triggerAssignmentReassigned).mockResolvedValue();
  vi.mocked(triggerAssignmentWithdrawn).mockResolvedValue();
  vi.mocked(prisma.assignment.findUnique).mockResolvedValue({
    driverId: "driver-1",
    orderId: "order-1"
  } as never);
});

describe("executeDriverAssignmentAction", () => {
  it.each([
    ["DEPART", "PLANNED", "EN_ROUTE", "S4"],
    ["ARRIVE", "EN_ROUTE", "IN_SERVICE", "S4"],
    ["COMPLETE", "IN_SERVICE", "COMPLETED", "S1"]
  ] as const)(
    "commits %s business fact, audit log, version and outbox atomically",
    async (action, fromStatus, targetStatus, driverStatus) => {
      const tx = createTransactionMock();
      runTransaction(tx);
      tx.assignment.findUnique.mockResolvedValue(
        executionAssignment(fromStatus)
      );
      tx.user.findUnique.mockResolvedValue({ id: "driver-user-1" });

      const result = await executeDriverAssignmentAction({
        action: action as DriverExecutionAction,
        assignmentId: "assignment-1",
        driverId: "driver-1",
        traceId: "trace-action"
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          executionStatus: targetStatus,
          planVersion: 6,
          replayed: false
        })
      });
      expect(tx.driver.update).toHaveBeenCalledWith({
        where: { id: "driver-1" },
        data: { status: driverStatus, planVersion: 6 }
      });
      expect(tx.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action,
          assignmentId: "assignment-1",
          traceId: "trace-action"
        })
      });
      expect(enqueueInternalEvent).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: action,
          assignmentId: "assignment-1",
          orderId: "order-1",
          driverId: "driver-1",
          traceId: "trace-action"
        })
      );
      expect(processInternalEvent).toHaveBeenCalledWith(
        `assignment-execution:assignment-1:${targetStatus}`
      );
      expect(
        Math.max(...vi.mocked(releaseResourceLock).mock.invocationCallOrder)
      ).toBeLessThan(
        vi.mocked(processInternalEvent).mock.invocationCallOrder[0]
      );
    }
  );

  it("replays an already-applied transition without a second write or event", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue(
      executionAssignment("EN_ROUTE", 6)
    );

    const result = await executeDriverAssignmentAction({
      action: "DEPART",
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: "trace-replay"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ replayed: true, planVersion: 6 })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
    expect(tx.driver.update).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
  });

  it("rejects a matrix-external transition with structured current and target status", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue(executionAssignment("PLANNED"));

    const result = await executeDriverAssignmentAction({
      action: "ARRIVE",
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: "trace-illegal"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "ILLEGAL_TRANSITION",
        details: { currentStatus: "PLANNED", targetStatus: "IN_SERVICE" }
      })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
  });

  it("rejects another driver's assignment before acquiring locks", async () => {
    vi.mocked(prisma.assignment.findUnique).mockResolvedValue({
      driverId: "driver-2",
      orderId: "order-1"
    } as never);

    const result = await executeDriverAssignmentAction({
      action: "DEPART",
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: "trace-forbidden"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: "FORBIDDEN" })
    });
    expect(acquireResourceLocks).not.toHaveBeenCalled();
  });

  it("returns 409 semantics when a short lock is busy", async () => {
    mockAllLocks("busy");

    const result = await executeDriverAssignmentAction({
      action: "DEPART",
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: "trace-busy"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: "DUPLICATE_OPERATION" })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("falls back to transaction row locks when Redis is unavailable", async () => {
    mockAllLocks("unavailable");
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue(executionAssignment("PLANNED"));
    tx.user.findUnique.mockResolvedValue({ id: "driver-user-1" });

    const result = await executeDriverAssignmentAction({
      action: "DEPART",
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: "trace-db-fallback"
    });

    expect(result.success).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(releaseResourceLock).not.toHaveBeenCalled();
  });
});

describe("reassignAssignment", () => {
  function setupReassignTx(
    executionStatus: "PLANNED" | "EN_ROUTE" | "IN_SERVICE" = "PLANNED"
  ) {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      status: "ACTIVE",
      driver: { id: "driver-1", name: "原司机", planVersion: 7 },
      order: {
        id: "order-1",
        orderNo: "G3E2E-001",
        currentAssignmentId: "assignment-1",
        executionStatus
      }
    });
    tx.driver.findUnique.mockResolvedValue({
      id: "driver-2",
      name: "目标司机",
      isActive: true,
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 3
    });
    tx.assignment.create.mockResolvedValue({ id: "assignment-2" });
    return tx;
  }

  function command() {
    return {
      assignmentId: "assignment-1",
      toDriverId: "driver-2",
      reason: "G3E2E manual reroute",
      expectedFromPlanVersion: 7,
      expectedToPlanVersion: 3,
      operatorUserId: "dispatcher-1",
      traceId: "trace-reassign"
    };
  }

  it("reassigns before arrival with two version checks and one transactional outbox event", async () => {
    const tx = setupReassignTx("EN_ROUTE");

    const result = await reassignAssignment(command());

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        assignmentId: "assignment-2",
        previousAssignmentId: "assignment-1",
        fromPlanVersion: 8,
        toPlanVersion: 4
      })
    });
    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: expect.objectContaining({
        status: "RECYCLED",
        sequenceNo: null,
        lockType: "NONE"
      })
    });
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: "driver-2",
        previousAssignmentId: "assignment-1",
        lockType: "MANUAL_LOCKED",
        type: "REASSIGN"
      }),
      select: { id: true }
    });
    expect(tx.driver.update).toHaveBeenNthCalledWith(1, {
      where: { id: "driver-1" },
      data: { status: "S1", planVersion: 8 }
    });
    expect(tx.driver.update).toHaveBeenNthCalledWith(2, {
      where: { id: "driver-2" },
      data: { status: "S3", planVersion: 4 }
    });
    expect(triggerAssignmentReassigned).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        eventId: "assignment-reassigned:assignment-1",
        assignmentId: "assignment-1",
        orderId: "order-1",
        toDriverId: "driver-2"
      })
    );
  });

  it("rejects a stale source or target version without writes", async () => {
    const tx = setupReassignTx();

    const result = await reassignAssignment({
      ...command(),
      expectedFromPlanVersion: 6
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "PLAN_VERSION_CONFLICT",
        details: {
          currentFromPlanVersion: 7,
          currentToPlanVersion: 3
        }
      })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
    expect(triggerAssignmentReassigned).not.toHaveBeenCalled();
  });

  it("rejects reassignment after arrival", async () => {
    const tx = setupReassignTx("IN_SERVICE");

    const result = await reassignAssignment(command());

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "ILLEGAL_TRANSITION",
        details: { currentStatus: "IN_SERVICE", targetStatus: "PLANNED" }
      })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
  });
});

describe("dispatcher plan edit commands", () => {
  it("manually assigns the first free slot and commits audit plus outbox atomically", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({ id: "driver-1" } as never);
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      name: "司机一",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 4,
      assignments: [{ sequenceNo: 1 }]
    });
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNo: "ORDER-1",
      executionStatus: "UNASSIGNED",
      currentAssignment: null
    });
    tx.assignment.create.mockResolvedValue({ id: "assignment-new" });

    const result = await assignOrder({
      orderId: "order-1",
      driverId: "driver-1",
      reason: "人工锁定",
      expectedPlanVersion: 4,
      operatorUserId: "dispatcher-1",
      traceId: "trace-assign"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        assignmentId: "assignment-new",
        planVersion: 5,
        replayed: false
      })
    });
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequenceNo: 2,
        lockType: "MANUAL_LOCKED",
        type: "MANUAL_ASSIGN"
      }),
      select: { id: true }
    });
    expect(triggerAssignmentAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        assignmentId: "assignment-new",
        eventId: "assignment-assigned:order-1:driver-1:5"
      })
    );
  });

  it("rejects a stale manual assignment version before creating facts", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({ id: "driver-1" } as never);
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      name: "司机一",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 5,
      assignments: []
    });
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNo: "ORDER-1",
      executionStatus: "UNASSIGNED",
      currentAssignment: null
    });

    const result = await assignOrder({
      orderId: "order-1",
      driverId: "driver-1",
      reason: "人工锁定",
      expectedPlanVersion: 4,
      operatorUserId: "dispatcher-1",
      traceId: "trace-stale"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "PLAN_VERSION_CONFLICT",
        details: { currentPlanVersion: 5 }
      })
    });
    expect(tx.assignment.create).not.toHaveBeenCalled();
  });

  it("withdraws only PLANNED assignments with one version increment", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      status: "ACTIVE",
      driver: { planVersion: 7 },
      order: {
        currentAssignmentId: "assignment-1",
        executionStatus: "PLANNED"
      }
    });

    const result = await withdrawAssignment({
      assignmentId: "assignment-1",
      reason: "撤回重排",
      expectedPlanVersion: 7,
      operatorUserId: "dispatcher-1",
      traceId: "trace-withdraw"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ planVersion: 8, replayed: false })
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      }
    });
    expect(triggerAssignmentWithdrawn).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        eventId: "assignment-withdrawn:assignment-1:8"
      })
    );
  });

  it("rejects withdrawal after service starts", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      status: "ACTIVE",
      driver: { planVersion: 7 },
      order: {
        currentAssignmentId: "assignment-1",
        executionStatus: "IN_SERVICE"
      }
    });

    const result = await withdrawAssignment({
      assignmentId: "assignment-1",
      reason: "非法撤回",
      expectedPlanVersion: 7,
      operatorUserId: "dispatcher-1",
      traceId: "trace-withdraw-illegal"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "ILLEGAL_TRANSITION",
        details: { currentStatus: "IN_SERVICE", targetStatus: "UNASSIGNED" }
      })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
  });

  it("unlocks a manual assignment and emits the dedicated event", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      status: "ACTIVE",
      lockType: "MANUAL_LOCKED",
      driver: { planVersion: 9 },
      order: {
        currentAssignmentId: "assignment-1",
        executionStatus: "PLANNED"
      }
    });

    const result = await unlockAssignment({
      assignmentId: "assignment-1",
      reason: "恢复自动排程",
      expectedPlanVersion: 9,
      operatorUserId: "dispatcher-1",
      traceId: "trace-unlock"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ planVersion: 10, replayed: false })
    });
    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "ASSIGNMENT_UNLOCKED",
        assignmentId: "assignment-1",
        eventId: "assignment-unlocked:assignment-1:10"
      })
    );
  });
});

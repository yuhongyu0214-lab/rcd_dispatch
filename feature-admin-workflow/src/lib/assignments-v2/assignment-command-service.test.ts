import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findUnique: vi.fn(), findMany: vi.fn() },
    order: { findUnique: vi.fn() },
    driver: { findFirst: vi.fn() },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/dispatch-v2/application/dispatch-snapshot-service", () => ({
  buildDispatchSnapshot: vi.fn()
}));

vi.mock("@/lib/dispatch-v2/application/eta-matrix-service", () => ({
  buildEtaMatrix: vi.fn()
}));

vi.mock("@/lib/dispatch-v2/core", () => ({ runDispatchV2: vi.fn() }));

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
import { buildDispatchSnapshot } from "@/lib/dispatch-v2/application/dispatch-snapshot-service";
import { buildEtaMatrix } from "@/lib/dispatch-v2/application/eta-matrix-service";
import { runDispatchV2 } from "@/lib/dispatch-v2/core";
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
      findMany: vi.fn().mockResolvedValue([]),
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

const calculatedAt = "2026-08-16T08:00:00.000Z";

function completePlan(orderId: string, sequenceNo: 1 | 2 | 3) {
  return {
    assignmentId: null,
    orderId,
    sequenceNo,
    slot: sequenceNo === 1 ? "A" : sequenceNo === 2 ? "B" : "C",
    plannedDepartAt: "2026-08-16T08:00:00.000Z",
    plannedPickupAt: "2026-08-16T08:12:00.000Z",
    plannedCompleteAt: "2026-08-16T08:52:00.000Z",
    deadheadEtaMinutes: 12,
    serviceEtaMinutes: 40,
    etaAvailable: true as const
  };
}

function orderInput(executionStatus: "UNASSIGNED" | "PLANNED" | "EN_ROUTE") {
  return {
    orderId: "order-1",
    orderNo: "ORDER-1",
    businessType: "STORE_PICKUP" as const,
    executionStatus,
    feasibility: "UNKNOWN" as const,
    slackMinutes: null,
    promisedPickupAt: "2026-08-16T09:00:00.000Z",
    pickupAddress: "取车点",
    pickupLocation: { lat: 31.2, lng: 121.4 },
    deliveryAddress: "送达点",
    deliveryLocation: { lat: 31.3, lng: 121.5 },
    storeCode: "STORE-1",
    currentAssignmentId:
      executionStatus === "UNASSIGNED" ? undefined : "assignment-1",
    serviceModuleMinutes: 0
  };
}

function driverInput(
  driverId: string,
  planVersion: number,
  assignments: Array<Record<string, unknown>> = []
) {
  return {
    driverId,
    storeCode: "STORE-1",
    onShift: true,
    availability: "AVAILABLE" as const,
    planVersion,
    locationFreshness: "FRESH" as const,
    lastLocation: {
      lat: 31.1,
      lng: 121.3,
      accuracyMeters: 10,
      capturedAt: "2026-08-16T07:59:30.000Z"
    },
    assignments
  };
}

function mockManualPlan() {
  vi.mocked(buildDispatchSnapshot).mockResolvedValue({
    event: {
      type: "ASSIGNMENT_EXECUTION_CHANGED",
      occurredAt: calculatedAt,
      orderId: "order-1",
      driverId: "driver-1"
    },
    orders: [orderInput("UNASSIGNED")],
    drivers: [driverInput("driver-1", 4)]
  } as never);
  vi.mocked(runDispatchV2).mockReturnValue({
    proposals: [
      {
        driverId: "driver-1",
        expectedPlanVersion: 4,
        assignments: [completePlan("order-1", 2)]
      }
    ],
    evaluations: [
      {
        orderId: "order-1",
        result: "PLANNED",
        bestSlackMinutes: 48,
        reason: "PLANNED"
      }
    ],
    calculatedAt
  });
}

function mockReassignPlans(includeRemainingAssignment = false) {
  const remainingOrder = {
    ...orderInput("PLANNED"),
    orderId: "order-2",
    orderNo: "ORDER-2",
    currentAssignmentId: "assignment-remaining",
    promisedPickupAt: "2026-08-16T10:00:00.000Z"
  };
  const remainingAssignment = {
    assignmentId: "assignment-remaining",
    orderId: "order-2",
    sequenceNo: 2,
    lockType: "NONE",
    executionStatus: "PLANNED",
    pickupLocation: { lat: 31.2, lng: 121.4 },
    deliveryLocation: { lat: 31.3, lng: 121.5 },
    serviceModuleMinutes: 0
  };
  vi.mocked(buildDispatchSnapshot).mockResolvedValue({
    event: {
      type: "ASSIGNMENT_EXECUTION_CHANGED",
      occurredAt: calculatedAt,
      orderId: "order-1",
      driverId: "driver-2",
      assignmentId: "assignment-1"
    },
    orders: [
      orderInput("EN_ROUTE"),
      ...(includeRemainingAssignment ? [remainingOrder] : [])
    ],
    drivers: [
      driverInput("driver-1", 7, [
        {
          assignmentId: "assignment-1",
          orderId: "order-1",
          sequenceNo: 1,
          lockType: "AUTO_FROZEN",
          executionStatus: "EN_ROUTE",
          pickupLocation: { lat: 31.2, lng: 121.4 },
          deliveryLocation: { lat: 31.3, lng: 121.5 },
          serviceModuleMinutes: 0
        },
        ...(includeRemainingAssignment ? [remainingAssignment] : [])
      ]),
      driverInput("driver-2", 3)
    ]
  } as never);
  vi.mocked(runDispatchV2).mockImplementation((input) => {
    const driver = input.drivers[0];
    if (driver.driverId === "driver-1") {
      return {
        proposals: [
          {
            driverId: "driver-1",
            expectedPlanVersion: 7,
            assignments: includeRemainingAssignment
              ? [completePlan("order-2", 1)]
              : []
          }
        ],
        evaluations: includeRemainingAssignment
          ? [
              {
                orderId: "order-2",
                result: "PLANNED" as const,
                bestSlackMinutes: 60,
                reason: "PLANNED" as const
              }
            ]
          : [],
        calculatedAt
      };
    }
    return {
      proposals: [
        {
          driverId: "driver-2",
          expectedPlanVersion: 3,
          assignments: [completePlan("order-1", 1)]
        }
      ],
      evaluations: [
        {
          orderId: "order-1",
          result: "PLANNED",
          bestSlackMinutes: 48,
          reason: "PLANNED"
        }
      ],
      calculatedAt
    };
  });
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
  vi.mocked(buildEtaMatrix).mockResolvedValue(() => 10);
  vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.driver.findFirst).mockResolvedValue({
    id: "driver-2",
    planVersion: 3
  } as never);
  vi.mocked(prisma.assignment.findUnique).mockResolvedValue({
    driverId: "driver-1",
    orderId: "order-1",
    driver: { planVersion: 7 }
  } as never);
});

function planReassignCommand() {
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

function setupPlanReassignTx(includeRemainingAssignment = false) {
  mockReassignPlans(includeRemainingAssignment);
  const tx = createTransactionMock();
  runTransaction(tx);
  tx.assignment.findMany
    .mockResolvedValueOnce([
      { id: "assignment-1", orderId: "order-1" },
      ...(includeRemainingAssignment
        ? [{ id: "assignment-remaining", orderId: "order-2" }]
        : [])
    ])
    .mockResolvedValueOnce([]);
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
      executionStatus: "EN_ROUTE",
      promisedPickupAt: new Date("2026-08-16T09:00:00.000Z"),
      pickupAddress: "取车点",
      pickupLat: 31.2,
      pickupLng: 121.4,
      deliveryAddress: "送达点",
      deliveryLat: 31.3,
      deliveryLng: 121.5
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
    executionStatus: "PLANNED" | "EN_ROUTE" | "IN_SERVICE" = "PLANNED",
    includeRemainingAssignment = false
  ) {
    mockReassignPlans(includeRemainingAssignment);
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findMany
      .mockResolvedValueOnce([
        { id: "assignment-1", orderId: "order-1" },
        ...(includeRemainingAssignment
          ? [{ id: "assignment-remaining", orderId: "order-2" }]
          : [])
      ])
      .mockResolvedValueOnce([]);
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
        executionStatus,
        promisedPickupAt: new Date("2026-08-16T09:00:00.000Z"),
        pickupAddress: "取车点",
        pickupLat: 31.2,
        pickupLng: 121.4,
        deliveryAddress: "送达点",
        deliveryLat: 31.3,
        deliveryLng: 121.5
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
        type: "REASSIGN",
        sequenceNo: 1,
        plannedDepartAt: new Date("2026-08-16T08:00:00.000Z"),
        plannedPickupAt: new Date("2026-08-16T08:12:00.000Z"),
        plannedCompleteAt: new Date("2026-08-16T08:52:00.000Z"),
        deadheadEtaMinutes: 12,
        serviceEtaMinutes: 40,
        etaUnavailableReason: null,
        lastEtaCalculatedAt: new Date(calculatedAt)
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
  it("manually assigns the core-selected complete slot and commits audit plus outbox atomically", async () => {
    mockManualPlan();
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({
      id: "driver-1",
      planVersion: 4
    } as never);
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.driver.findFirst.mockResolvedValue({
      id: "driver-1",
      name: "司机一",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 4
    });
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNo: "ORDER-1",
      executionStatus: "UNASSIGNED",
      promisedPickupAt: new Date("2026-08-16T09:00:00.000Z"),
      pickupAddress: "取车点",
      pickupLat: 31.2,
      pickupLng: 121.4,
      deliveryAddress: "送达点",
      deliveryLat: 31.3,
      deliveryLng: 121.5,
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
        type: "MANUAL_ASSIGN",
        plannedDepartAt: new Date("2026-08-16T08:00:00.000Z"),
        plannedPickupAt: new Date("2026-08-16T08:12:00.000Z"),
        plannedCompleteAt: new Date("2026-08-16T08:52:00.000Z"),
        deadheadEtaMinutes: 12,
        serviceEtaMinutes: 40,
        etaUnavailableReason: null,
        lastEtaCalculatedAt: new Date(calculatedAt)
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
    expect(
      vi.mocked(buildEtaMatrix).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]);
  });

  it("replans the source driver's remaining work and the target assignment in one transaction", async () => {
    const tx = setupPlanReassignTx(true);

    const result = await reassignAssignment(planReassignCommand());

    expect(result.success).toBe(true);
    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-remaining" },
      data: {
        sequenceNo: 1,
        plannedDepartAt: new Date("2026-08-16T08:00:00.000Z"),
        plannedPickupAt: new Date("2026-08-16T08:12:00.000Z"),
        plannedCompleteAt: new Date("2026-08-16T08:52:00.000Z"),
        deadheadEtaMinutes: 12,
        serviceEtaMinutes: 40,
        etaUnavailableReason: null,
        lastEtaCalculatedAt: new Date(calculatedAt)
      }
    });
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: "driver-2",
        sequenceNo: 1,
        lastEtaCalculatedAt: new Date(calculatedAt)
      }),
      select: { id: true }
    });
  });

  it("returns dependency unavailable without writes when target ETA cannot be resolved", async () => {
    const tx = setupPlanReassignTx();
    vi.mocked(buildEtaMatrix).mockRejectedValue(
      new Error("ETA_MATRIX_RETRYABLE_FAILURE")
    );

    const result = await reassignAssignment(planReassignCommand());

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "DEPENDENCY_UNAVAILABLE",
        details: { dependency: "AMAP" }
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.assignment.update).not.toHaveBeenCalled();
    expect(triggerAssignmentReassigned).not.toHaveBeenCalled();
  });

  it("returns validation failed without writes when the target driver has no feasible slot", async () => {
    const tx = setupPlanReassignTx();
    vi.mocked(runDispatchV2).mockImplementation((input) => {
      const driver = input.drivers[0];
      if (driver.driverId === "driver-1") {
        return {
          proposals: [
            { driverId: "driver-1", expectedPlanVersion: 7, assignments: [] }
          ],
          evaluations: [],
          calculatedAt
        };
      }
      return {
        proposals: [
          { driverId: "driver-2", expectedPlanVersion: 3, assignments: [] }
        ],
        evaluations: [
          {
            orderId: "order-1",
            result: "UNPLANNED",
            bestSlackMinutes: null,
            reason: "NO_AVAILABLE_SLOT"
          }
        ],
        calculatedAt
      };
    });

    const result = await reassignAssignment(planReassignCommand());

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "VALIDATION_FAILED",
        details: { fields: { toDriverId: ["Driver has no feasible A/B/C plan"] } }
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.assignment.create).not.toHaveBeenCalled();
  });

  it("returns dependency unavailable without facts when manual assignment ETA is unavailable", async () => {
    mockManualPlan();
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({
      id: "driver-1",
      planVersion: 4
    } as never);
    vi.mocked(buildEtaMatrix).mockRejectedValue(new Error("AMAP_TIMEOUT"));

    const result = await assignOrder({
      orderId: "order-1",
      driverId: "driver-1",
      reason: "人工锁定",
      expectedPlanVersion: 4,
      operatorUserId: "dispatcher-1",
      traceId: "trace-assign-eta-fail"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "DEPENDENCY_UNAVAILABLE",
        details: { dependency: "AMAP" }
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(triggerAssignmentAssigned).not.toHaveBeenCalled();
  });

  it("returns validation failed without facts when the selected driver has no feasible slot", async () => {
    mockManualPlan();
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({
      id: "driver-1",
      planVersion: 4
    } as never);
    vi.mocked(runDispatchV2).mockReturnValue({
      proposals: [
        { driverId: "driver-1", expectedPlanVersion: 4, assignments: [] }
      ],
      evaluations: [
        {
          orderId: "order-1",
          result: "UNPLANNED",
          bestSlackMinutes: null,
          reason: "NO_AVAILABLE_SLOT"
        }
      ],
      calculatedAt
    });

    const result = await assignOrder({
      orderId: "order-1",
      driverId: "driver-1",
      reason: "人工锁定",
      expectedPlanVersion: 4,
      operatorUserId: "dispatcher-1",
      traceId: "trace-no-slot"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "VALIDATION_FAILED",
        details: { fields: { driverId: ["Driver has no feasible A/B/C plan"] } }
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(triggerAssignmentAssigned).not.toHaveBeenCalled();
  });

  it("rejects a stale manual assignment version before creating facts", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(prisma.driver.findFirst).mockResolvedValue({
      id: "driver-1",
      planVersion: 5
    } as never);
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

  it("rejects repeated plan edits by stale version instead of inferring replay", async () => {
    const tx = createTransactionMock();
    runTransaction(tx);
    tx.assignment.findUnique
      .mockResolvedValueOnce({
        id: "assignment-1",
        orderId: "order-1",
        driverId: "driver-1",
        status: "WITHDRAWN",
        driver: { planVersion: 8 },
        order: {
          currentAssignmentId: null,
          executionStatus: "UNASSIGNED"
        }
      })
      .mockResolvedValueOnce({
        id: "assignment-1",
        orderId: "order-1",
        driverId: "driver-1",
        status: "ACTIVE",
        lockType: "NONE",
        driver: { planVersion: 10 },
        order: {
          currentAssignmentId: "assignment-1",
          executionStatus: "PLANNED"
        }
      });

    const withdrawResult = await withdrawAssignment({
      assignmentId: "assignment-1",
      reason: "重复撤回",
      expectedPlanVersion: 7,
      operatorUserId: "dispatcher-1",
      traceId: "trace-repeat-withdraw"
    });
    const unlockResult = await unlockAssignment({
      assignmentId: "assignment-1",
      reason: "重复解锁",
      expectedPlanVersion: 9,
      operatorUserId: "dispatcher-1",
      traceId: "trace-repeat-unlock"
    });

    expect(withdrawResult).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "PLAN_VERSION_CONFLICT",
        details: { currentPlanVersion: 8 }
      })
    });
    expect(unlockResult).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "PLAN_VERSION_CONFLICT",
        details: { currentPlanVersion: 10 }
      })
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
  });
});

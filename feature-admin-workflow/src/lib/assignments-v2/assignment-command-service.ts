import { randomUUID } from "node:crypto";

import type { OrderExecutionStatus, Prisma } from "@prisma/client";

import { createApiErrorV2 } from "@/lib/contracts/v2";
import { buildDispatchSnapshot } from "@/lib/dispatch-v2/application/dispatch-snapshot-service";
import { buildEtaMatrix } from "@/lib/dispatch-v2/application/eta-matrix-service";
import { runDispatchV2 } from "@/lib/dispatch-v2/core";
import { enqueueInternalEvent } from "@/lib/events/store";
import { processInternalEvent } from "@/lib/events/processor";
import { createLogger } from "@/lib/logger";
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

import type {
  ApiErrorV2,
  DispatchDriverPlanProposalV2,
  DispatchInputV2,
  DispatchPlannedAssignmentV2,
  IsoDateTimeStringV2
} from "@/types/v2";

export type DriverExecutionAction = "DEPART" | "ARRIVE" | "COMPLETE";

export type DriverExecutionResult = CommandResult<{
  assignmentId: string;
  orderId: string;
  driverId: string;
  executionStatus: OrderExecutionStatus;
  planVersion: number;
  replayed: boolean;
}>;

export type ReassignResult = CommandResult<{
  assignmentId: string;
  previousAssignmentId: string;
  orderId: string;
  fromDriverId: string;
  toDriverId: string;
  fromPlanVersion: number;
  toPlanVersion: number;
  replayed: false;
}>;

export type AssignResult = CommandResult<{
  assignmentId: string;
  orderId: string;
  driverId: string;
  planVersion: number;
  replayed: boolean;
}>;

export type WithdrawResult = CommandResult<{
  assignmentId: string;
  orderId: string;
  driverId: string;
  planVersion: number;
  replayed: boolean;
}>;

export type UnlockResult = CommandResult<{
  assignmentId: string;
  orderId: string;
  driverId: string;
  planVersion: number;
  replayed: boolean;
}>;

type CommandResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorV2 };

type HeldLock = {
  resourceKey: string;
  token: string;
};

const log = createLogger("assignment-commands-v2");

const EXECUTION_RULES = {
  DEPART: {
    from: "PLANNED",
    target: "EN_ROUTE",
    eventType: "DEPART",
    operationAction: "DEPART"
  },
  ARRIVE: {
    from: "EN_ROUTE",
    target: "IN_SERVICE",
    eventType: "ARRIVE",
    operationAction: "ARRIVE"
  },
  COMPLETE: {
    from: "IN_SERVICE",
    target: "COMPLETED",
    eventType: "COMPLETE",
    operationAction: "COMPLETE"
  }
} as const;

async function acquireCommandLocks(resourceKeys: string[]) {
  const resources = [...new Set(resourceKeys)].sort().map((resourceKey) => ({
    resourceKey,
    token: randomUUID(),
    ttlSeconds: 15
  }));
  const results = await acquireResourceLocks(resources);

  if ([...results.values()].includes("busy")) {
    return { busy: true, heldLocks: [] as HeldLock[] };
  }

  const allAcquired =
    results.size === resources.length &&
    resources.every(
      ({ resourceKey }) => results.get(resourceKey) === "acquired"
    );

  return {
    busy: false,
    heldLocks: allAcquired
      ? resources.map(({ resourceKey, token }) => ({ resourceKey, token }))
      : []
  };
}

async function releaseCommandLocks(heldLocks: HeldLock[]) {
  for (const lock of [...heldLocks].reverse()) {
    await releaseResourceLock(lock.resourceKey, lock.token);
  }
}

function illegalTransition(
  currentStatus: OrderExecutionStatus,
  targetStatus: OrderExecutionStatus
) {
  return createApiErrorV2(
    "ILLEGAL_TRANSITION",
    `Cannot transition assignment from ${currentStatus} to ${targetStatus}`,
    { currentStatus, targetStatus }
  );
}

async function processEventBestEffort(eventId: string, traceId: string) {
  try {
    await processInternalEvent(eventId);
  } catch (error) {
    log.error("assignment_event_processing_failed", {
      eventId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function executeDriverAssignmentAction(params: {
  action: DriverExecutionAction;
  assignmentId: string;
  driverId: string;
  traceId: string;
}): Promise<DriverExecutionResult> {
  const preflight = await prisma.assignment.findUnique({
    where: { id: params.assignmentId },
    select: { driverId: true, orderId: true }
  });

  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Assignment not found")
    };
  }

  if (preflight.driverId !== params.driverId) {
    return {
      success: false,
      error: createApiErrorV2(
        "FORBIDDEN",
        "Drivers may only operate their own assignments"
      )
    };
  }

  const locks = await acquireCommandLocks([
    `dispatch:lock:${params.driverId}`,
    `order:lock:${preflight.orderId}`
  ]);

  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another assignment operation is in progress"
      )
    };
  }

  try {
    const rule = EXECUTION_RULES[params.action];
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: DriverExecutionResult & { success: true }; eventId: string }
      | { kind: "replayed"; data: DriverExecutionResult & { success: true } }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver"
        WHERE "id" = ${params.driverId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${preflight.orderId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Assignment"
        WHERE "id" = ${params.assignmentId}
        FOR UPDATE
      `;

      const assignment = await tx.assignment.findUnique({
        where: { id: params.assignmentId },
        include: {
          driver: { select: { id: true, planVersion: true } },
          order: {
            select: {
              id: true,
              currentAssignmentId: true,
              executionStatus: true
            }
          }
        }
      });

      if (!assignment) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Assignment not found")
        };
      }

      if (assignment.driverId !== params.driverId) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "FORBIDDEN",
            "Drivers may only operate their own assignments"
          )
        };
      }

      const currentStatus = assignment.order.executionStatus;
      const currentPlanVersion = assignment.driver.planVersion;

      if (currentStatus === rule.target) {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: {
              assignmentId: assignment.id,
              orderId: assignment.orderId,
              driverId: assignment.driverId,
              executionStatus: currentStatus,
              planVersion: currentPlanVersion,
              replayed: true
            }
          }
        };
      }

      if (
        currentStatus !== rule.from ||
        assignment.order.currentAssignmentId !== assignment.id
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(currentStatus, rule.target)
        };
      }

      const operator = await tx.user.findUnique({
        where: { driverId: params.driverId },
        select: { id: true }
      });

      if (!operator) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "INTERNAL_ERROR",
            "No bound driver user is available for audit logging"
          )
        };
      }

      const occurredAt = new Date();
      const assignmentData: Prisma.AssignmentUpdateInput =
        params.action === "DEPART"
          ? { departedAt: occurredAt, lockType: "AUTO_FROZEN" }
          : params.action === "ARRIVE"
            ? { arrivedAt: occurredAt }
            : {
                completedAt: occurredAt,
                status: "COMPLETED",
                sequenceNo: null,
                lockType: "NONE"
              };

      await tx.assignment.update({
        where: { id: assignment.id },
        data: assignmentData
      });

      const orderData: Prisma.OrderUpdateInput =
        params.action === "DEPART"
          ? { executionStatus: "EN_ROUTE" }
          : params.action === "ARRIVE"
            ? { executionStatus: "IN_SERVICE", status: "IN_PROGRESS" }
            : { executionStatus: "COMPLETED", status: "COMPLETED" };

      await tx.order.update({
        where: { id: assignment.orderId },
        data: orderData
      });

      const nextPlanVersion = currentPlanVersion + 1;
      await tx.driver.update({
        where: { id: params.driverId },
        data: {
          status: params.action === "COMPLETE" ? "S1" : "S4",
          planVersion: nextPlanVersion
        }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ASSIGNMENT",
          entityId: assignment.id,
          action: rule.operationAction,
          operatorUserId: operator.id,
          orderId: assignment.orderId,
          driverId: params.driverId,
          assignmentId: assignment.id,
          traceId: params.traceId,
          reason: `Driver assignment ${params.action.toLowerCase()}`,
          metadataJson: {
            actor: "DRIVER_API",
            fromExecutionStatus: currentStatus,
            toExecutionStatus: rule.target,
            previousPlanVersion: currentPlanVersion,
            nextPlanVersion
          }
        }
      });

      const eventId = `assignment-execution:${assignment.id}:${rule.target}`;
      await enqueueInternalEvent(tx, {
        eventId,
        type: rule.eventType,
        orderId: assignment.orderId,
        driverId: params.driverId,
        assignmentId: assignment.id,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });

      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            assignmentId: assignment.id,
            orderId: assignment.orderId,
            driverId: params.driverId,
            executionStatus: rule.target,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }

    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(
        transactionResult.eventId,
        params.traceId
      );
    }

    return transactionResult.data;
  } catch (error) {
    log.error("driver_assignment_action_failed", {
      action: params.action,
      assignmentId: params.assignmentId,
      driverId: params.driverId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Assignment action failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

export async function reassignAssignment(params: {
  assignmentId: string;
  toDriverId: string;
  reason: string;
  expectedFromPlanVersion: number;
  expectedToPlanVersion: number;
  operatorUserId: string;
  traceId: string;
}): Promise<ReassignResult> {
  const [preflight, targetPreflight] = await Promise.all([
    prisma.assignment.findUnique({
      where: { id: params.assignmentId },
      select: {
        driverId: true,
        orderId: true,
        driver: { select: { planVersion: true } }
      }
    }),
    prisma.driver.findFirst({
      where: { id: params.toDriverId, isActive: true },
      select: { id: true, planVersion: true }
    })
  ]);

  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Assignment not found")
    };
  }

  if (!targetPreflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Target driver not found")
    };
  }

  if (
    preflight.driver.planVersion !== params.expectedFromPlanVersion ||
    targetPreflight.planVersion !== params.expectedToPlanVersion
  ) {
    return {
      success: false,
      error: createApiErrorV2(
        "PLAN_VERSION_CONFLICT",
        "One or both driver plan versions are stale",
        {
          currentFromPlanVersion: preflight.driver.planVersion,
          currentToPlanVersion: targetPreflight.planVersion
        }
      )
    };
  }

  if (preflight.driverId === params.toDriverId) {
    return {
      success: false,
      error: createApiErrorV2(
        "VALIDATION_FAILED",
        "Target driver must differ from the current driver",
        { fields: { toDriverId: ["Must differ from current driver"] } }
      )
    };
  }

  const locks = await acquireCommandLocks([
    `dispatch:lock:${preflight.driverId}`,
    `dispatch:lock:${params.toDriverId}`,
    `order:lock:${preflight.orderId}`
  ]);

  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another plan edit is in progress"
      )
    };
  }

  try {
    const occurredAt = new Date();
    const snapshot = await buildDispatchSnapshot({
      type: "ASSIGNMENT_EXECUTION_CHANGED",
      occurredAt: occurredAt.toISOString(),
      orderId: preflight.orderId,
      driverId: params.toDriverId,
      assignmentId: params.assignmentId
    });
    const sourcePlan = await prepareScopedDriverPlan({
      snapshot,
      driverId: preflight.driverId,
      traceId: params.traceId,
      excludedAssignmentId: params.assignmentId,
      validationField: "toDriverId"
    });
    if (!sourcePlan.success) return sourcePlan;

    const targetPlan = await prepareScopedDriverPlan({
      snapshot,
      driverId: params.toDriverId,
      traceId: params.traceId,
      insertedOrderId: preflight.orderId,
      validationField: "toDriverId"
    });
    if (!targetPlan.success) return targetPlan;

    const plannedAssignment = targetPlan.plan.assignments.find(
      (assignment) =>
        assignment.assignmentId === null &&
        assignment.orderId === preflight.orderId
    );
    if (!plannedAssignment || !isCompletePlan(plannedAssignment)) {
      return {
        success: false,
        error: dependencyUnavailable("ETA calculation is unavailable")
      };
    }
    const plannedOrder = snapshot.orders.find(
      (order) => order.orderId === preflight.orderId
    );

    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: ReassignResult & { success: true }; eventId: string }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      for (const driverId of [preflight.driverId, params.toDriverId].sort()) {
        await tx.$queryRaw`
          SELECT "id" FROM "Driver"
          WHERE "id" = ${driverId}
          FOR UPDATE
        `;
      }
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${preflight.orderId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Assignment"
        WHERE "id" = ${params.assignmentId}
        FOR UPDATE
      `;

      const assignment = await tx.assignment.findUnique({
        where: { id: params.assignmentId },
        include: {
          driver: {
            select: { id: true, name: true, planVersion: true }
          },
          order: {
            select: {
              id: true,
              orderNo: true,
              currentAssignmentId: true,
              executionStatus: true,
              promisedPickupAt: true,
              pickupAddress: true,
              pickupLat: true,
              pickupLng: true,
              deliveryAddress: true,
              deliveryLat: true,
              deliveryLng: true
            }
          }
        }
      });
      const targetDriver = await tx.driver.findUnique({
        where: { id: params.toDriverId },
        select: {
          id: true,
          name: true,
          isActive: true,
          onShift: true,
          availability: true,
          planVersion: true
        }
      });

      if (!assignment) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Assignment not found")
        };
      }

      if (!targetDriver || !targetDriver.isActive) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Target driver not found")
        };
      }

      if (
        assignment.driver.planVersion !== params.expectedFromPlanVersion ||
        targetDriver.planVersion !== params.expectedToPlanVersion ||
        sourcePlan.plan.expectedPlanVersion !== assignment.driver.planVersion ||
        targetPlan.plan.expectedPlanVersion !== targetDriver.planVersion
      ) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "PLAN_VERSION_CONFLICT",
            "One or both driver plan versions are stale",
            {
              currentFromPlanVersion: assignment.driver.planVersion,
              currentToPlanVersion: targetDriver.planVersion
            }
          )
        };
      }

      if (
        assignment.order.currentAssignmentId !== assignment.id ||
        !["ACTIVE", "ACCEPTED"].includes(assignment.status)
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(
            assignment.order.executionStatus,
            "PLANNED"
          )
        };
      }

      if (
        assignment.order.executionStatus !== "PLANNED" &&
        assignment.order.executionStatus !== "EN_ROUTE"
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(
            assignment.order.executionStatus,
            "PLANNED"
          )
        };
      }

      if (
        !plannedOrder ||
        assignment.order.promisedPickupAt.getTime() !==
          new Date(plannedOrder.promisedPickupAt).getTime() ||
        assignment.order.pickupAddress !== plannedOrder.pickupAddress ||
        assignment.order.pickupLat !== (plannedOrder.pickupLocation?.lat ?? null) ||
        assignment.order.pickupLng !== (plannedOrder.pickupLocation?.lng ?? null) ||
        assignment.order.deliveryAddress !== plannedOrder.deliveryAddress ||
        assignment.order.deliveryLat !==
          (plannedOrder.deliveryLocation?.lat ?? null) ||
        assignment.order.deliveryLng !==
          (plannedOrder.deliveryLocation?.lng ?? null)
      ) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Order changed while planning; refresh and retry"
          )
        };
      }

      if (!targetDriver.onShift || targetDriver.availability !== "AVAILABLE") {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "VALIDATION_FAILED",
            "Target driver must be on shift and available",
            {
              fields: {
                toDriverId: ["Driver must be on shift and available"]
              }
            }
          )
        };
      }

      const sourcePlanApplied = await applyPreparedDriverPlan({
        tx,
        plan: sourcePlan.plan,
        excludedAssignmentId: assignment.id
      });
      const targetPlanApplied = await applyPreparedDriverPlan({
        tx,
        plan: targetPlan.plan,
        insertedOrderId: assignment.orderId
      });
      if (!sourcePlanApplied || !targetPlanApplied) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Driver plan changed; refresh and retry"
          )
        };
      }

      await tx.assignment.update({
        where: { id: assignment.id },
        data: {
          status: "RECYCLED",
          recycledAt: occurredAt,
          sequenceNo: null,
          lockType: "NONE"
        }
      });

      const nextAssignment = await tx.assignment.create({
        data: {
          orderId: assignment.orderId,
          driverId: targetDriver.id,
          type: "REASSIGN",
          status: "ACTIVE",
          previousAssignmentId: assignment.id,
          createdByUserId: params.operatorUserId,
          lockType: "MANUAL_LOCKED",
          ...toPlanWriteData(plannedAssignment, targetPlan.plan.calculatedAt)
        },
        select: { id: true }
      });

      await tx.order.update({
        where: { id: assignment.orderId },
        data: {
          executionStatus: "PLANNED",
          status: "ASSIGNED",
          currentAssignmentId: nextAssignment.id,
          driverNameSnapshot: targetDriver.name
        }
      });

      const nextFromPlanVersion = assignment.driver.planVersion + 1;
      const nextToPlanVersion = targetDriver.planVersion + 1;
      await tx.driver.update({
        where: { id: assignment.driverId },
        data: { status: "S1", planVersion: nextFromPlanVersion }
      });
      await tx.driver.update({
        where: { id: targetDriver.id },
        data: { status: "S3", planVersion: nextToPlanVersion }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ASSIGNMENT",
          entityId: nextAssignment.id,
          action: "REASSIGN",
          operatorUserId: params.operatorUserId,
          orderId: assignment.orderId,
          driverId: targetDriver.id,
          assignmentId: nextAssignment.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            orderNo: assignment.order.orderNo,
            fromDriverId: assignment.driverId,
            fromDriverName: assignment.driver.name,
            toDriverId: targetDriver.id,
            toDriverName: targetDriver.name,
            previousAssignmentId: assignment.id,
            nextAssignmentId: nextAssignment.id,
            previousExecutionStatus: assignment.order.executionStatus,
            expectedFromPlanVersion: params.expectedFromPlanVersion,
            expectedToPlanVersion: params.expectedToPlanVersion,
            nextFromPlanVersion,
            nextToPlanVersion,
            sourcePlan: sourcePlan.plan.assignments.map((planned) => ({
              assignmentId: planned.assignmentId,
              orderId: planned.orderId,
              sequenceNo: planned.sequenceNo
            })),
            targetPlan: targetPlan.plan.assignments.map((planned) => ({
              assignmentId: planned.assignmentId,
              orderId: planned.orderId,
              sequenceNo: planned.sequenceNo
            }))
          }
        }
      });

      const eventId = `assignment-reassigned:${assignment.id}`;
      await triggerAssignmentReassigned({
        tx,
        eventId,
        assignmentId: assignment.id,
        orderId: assignment.orderId,
        toDriverId: targetDriver.id,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });

      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            assignmentId: nextAssignment.id,
            previousAssignmentId: assignment.id,
            orderId: assignment.orderId,
            fromDriverId: assignment.driverId,
            toDriverId: targetDriver.id,
            fromPlanVersion: nextFromPlanVersion,
            toPlanVersion: nextToPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }

    await releaseCommandLocks(locks.heldLocks);
    locks.heldLocks.length = 0;
    await processEventBestEffort(transactionResult.eventId, params.traceId);
    return transactionResult.data;
  } catch (error) {
    log.error("assignment_reassign_failed", {
      assignmentId: params.assignmentId,
      toDriverId: params.toDriverId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Reassignment failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

type CompletePlannedAssignment = DispatchPlannedAssignmentV2 & {
  etaAvailable: true;
  plannedDepartAt: IsoDateTimeStringV2;
  plannedPickupAt: IsoDateTimeStringV2;
  plannedCompleteAt: IsoDateTimeStringV2;
  deadheadEtaMinutes: number;
  serviceEtaMinutes: number;
};

type PreparedDriverPlan = {
  driverId: string;
  expectedPlanVersion: number;
  calculatedAt: Date;
  assignments: DispatchDriverPlanProposalV2["assignments"];
};

type PreparePlanResult =
  | { success: true; plan: PreparedDriverPlan }
  | { success: false; error: ApiErrorV2 };

type PlanWriteData = {
  sequenceNo: number;
  plannedDepartAt: Date;
  plannedPickupAt: Date;
  plannedCompleteAt: Date;
  deadheadEtaMinutes: number;
  serviceEtaMinutes: number;
  etaUnavailableReason: null;
  lastEtaCalculatedAt: Date;
};

function dependencyUnavailable(message: string) {
  return createApiErrorV2("DEPENDENCY_UNAVAILABLE", message, {
    dependency: "AMAP"
  });
}

function noFeasiblePlan(field: "driverId" | "toDriverId", message: string) {
  return createApiErrorV2("VALIDATION_FAILED", message, {
    fields: { [field]: [message] }
  });
}

function isCompletePlan(
  assignment: DispatchPlannedAssignmentV2
): assignment is CompletePlannedAssignment {
  return (
    assignment.etaAvailable === true &&
    assignment.plannedDepartAt !== undefined &&
    assignment.plannedPickupAt !== undefined &&
    assignment.plannedCompleteAt !== undefined &&
    assignment.deadheadEtaMinutes !== undefined &&
    assignment.serviceEtaMinutes !== undefined
  );
}

function toPlanWriteData(
  assignment: CompletePlannedAssignment,
  calculatedAt: Date
): PlanWriteData {
  return {
    sequenceNo: assignment.sequenceNo,
    plannedDepartAt: new Date(assignment.plannedDepartAt),
    plannedPickupAt: new Date(assignment.plannedPickupAt),
    plannedCompleteAt: new Date(assignment.plannedCompleteAt),
    deadheadEtaMinutes: assignment.deadheadEtaMinutes,
    serviceEtaMinutes: assignment.serviceEtaMinutes,
    etaUnavailableReason: null,
    lastEtaCalculatedAt: calculatedAt
  };
}

async function prepareScopedDriverPlan(params: {
  snapshot: DispatchInputV2;
  driverId: string;
  traceId: string;
  insertedOrderId?: string;
  excludedAssignmentId?: string;
  validationField: "driverId" | "toDriverId";
}): Promise<PreparePlanResult> {
  const driver = params.snapshot.drivers.find(
    (candidate) => candidate.driverId === params.driverId
  );
  if (!driver) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Driver not found")
    };
  }

  const assignments = driver.assignments.filter(
    (assignment) =>
      assignment.assignmentId !== params.excludedAssignmentId &&
      assignment.orderId !== params.insertedOrderId
  );
  const scopedOrderIds = new Set(assignments.map((assignment) => assignment.orderId));
  if (params.insertedOrderId) scopedOrderIds.add(params.insertedOrderId);

  const scopedOrders = params.snapshot.orders
    .filter((order) => scopedOrderIds.has(order.orderId))
    .map((order) =>
      order.orderId === params.insertedOrderId
        ? {
            ...order,
            executionStatus: "UNASSIGNED" as const,
            currentAssignmentId: undefined
          }
        : order
    );

  if (
    params.insertedOrderId &&
    !scopedOrders.some((order) => order.orderId === params.insertedOrderId)
  ) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Order not found")
    };
  }

  const scopedInput: DispatchInputV2 = {
    event: params.snapshot.event,
    orders: scopedOrders,
    drivers: [{ ...driver, assignments }]
  };

  let etaResolver: Awaited<ReturnType<typeof buildEtaMatrix>>;
  try {
    etaResolver = await buildEtaMatrix(scopedInput, params.traceId);
  } catch (error) {
    log.warn("assignment_plan_eta_unavailable", {
      driverId: params.driverId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: dependencyUnavailable("ETA calculation is unavailable")
    };
  }
  const output = runDispatchV2(scopedInput, etaResolver);

  const proposal = output.proposals.find(
    (candidate) => candidate.driverId === params.driverId
  );
  if (!proposal) {
    return {
      success: false,
      error: noFeasiblePlan(
        params.validationField,
        "Driver has no feasible A/B/C plan"
      )
    };
  }

  const incompleteEvaluation = output.evaluations.find(
    (evaluation) => evaluation.result === "ETA_UNAVAILABLE"
  );
  if (incompleteEvaluation) {
    return {
      success: false,
      error: dependencyUnavailable("ETA calculation is unavailable")
    };
  }

  const unplannedEvaluation = output.evaluations.find(
    (evaluation) => evaluation.result !== "PLANNED"
  );
  if (unplannedEvaluation) {
    return {
      success: false,
      error: noFeasiblePlan(
        params.validationField,
        "Driver has no feasible A/B/C plan"
      )
    };
  }

  if (params.insertedOrderId) {
    const inserted = proposal.assignments.find(
      (assignment) =>
        assignment.orderId === params.insertedOrderId &&
        assignment.assignmentId === null
    );
    if (!inserted) {
      return {
        success: false,
        error: noFeasiblePlan(
          params.validationField,
          "Driver has no feasible A/B/C plan"
        )
      };
    }
    if (!isCompletePlan(inserted)) {
      return {
        success: false,
        error: dependencyUnavailable("ETA calculation is unavailable")
      };
    }
  }

  for (const assignment of proposal.assignments) {
    if (assignment.assignmentId === null && !isCompletePlan(assignment)) {
      return {
        success: false,
        error: dependencyUnavailable("ETA calculation is unavailable")
      };
    }
  }

  const persistedIds = proposal.assignments
    .map((assignment) => assignment.assignmentId)
    .filter((assignmentId): assignmentId is string => assignmentId !== null);
  if (persistedIds.length > 0) {
    const persisted = await prisma.assignment.findMany({
      where: { id: { in: persistedIds } },
      select: {
        id: true,
        plannedDepartAt: true,
        plannedPickupAt: true,
        plannedCompleteAt: true,
        deadheadEtaMinutes: true,
        serviceEtaMinutes: true,
        etaUnavailableReason: true,
        lastEtaCalculatedAt: true
      }
    });
    const persistedMap = new Map(persisted.map((assignment) => [assignment.id, assignment]));
    const incompletePersisted = persistedIds.some((assignmentId) => {
      const assignment = persistedMap.get(assignmentId);
      return (
        !assignment ||
        assignment.plannedDepartAt === null ||
        assignment.plannedPickupAt === null ||
        assignment.plannedCompleteAt === null ||
        assignment.deadheadEtaMinutes === null ||
        assignment.serviceEtaMinutes === null ||
        assignment.etaUnavailableReason !== null ||
        assignment.lastEtaCalculatedAt === null
      );
    });
    if (incompletePersisted) {
      return {
        success: false,
        error: dependencyUnavailable("Existing locked plan is incomplete")
      };
    }
  }

  return {
    success: true,
    plan: {
      driverId: params.driverId,
      expectedPlanVersion: proposal.expectedPlanVersion,
      calculatedAt: new Date(output.calculatedAt),
      assignments: proposal.assignments
    }
  };
}

async function applyPreparedDriverPlan(params: {
  tx: Prisma.TransactionClient;
  plan: PreparedDriverPlan;
  insertedOrderId?: string;
  excludedAssignmentId?: string;
}): Promise<boolean> {
  const activeAssignments = await params.tx.assignment.findMany({
    where: {
      driverId: params.plan.driverId,
      status: { in: ["ACTIVE", "ACCEPTED"] },
      order: { executionStatus: { notIn: ["COMPLETED", "CANCELLED"] } }
    },
    select: { id: true, orderId: true }
  });
  const activeById = new Map(
    activeAssignments.map((assignment) => [assignment.id, assignment])
  );
  const activeByOrderId = new Map(
    activeAssignments.map((assignment) => [assignment.orderId, assignment])
  );
  const coveredIds = new Set<string>();

  for (const planned of params.plan.assignments) {
    if (planned.assignmentId !== null) {
      const current = activeById.get(planned.assignmentId);
      if (!current || current.orderId !== planned.orderId) return false;
      coveredIds.add(current.id);
      continue;
    }
    if (planned.orderId === params.insertedOrderId) continue;
    if (!isCompletePlan(planned)) return false;
    const current = activeByOrderId.get(planned.orderId);
    if (!current || current.id === params.excludedAssignmentId) return false;
    coveredIds.add(current.id);
    await params.tx.assignment.update({
      where: { id: current.id },
      data: toPlanWriteData(planned, params.plan.calculatedAt)
    });
  }

  return activeAssignments.every(
    (assignment) =>
      assignment.id === params.excludedAssignmentId || coveredIds.has(assignment.id)
  );
}

export async function assignOrder(params: {
  orderId: string;
  driverId: string;
  reason: string;
  expectedPlanVersion: number;
  operatorUserId: string;
  traceId: string;
}): Promise<AssignResult> {
  const [orderExists, driverExists] = await Promise.all([
    prisma.order.findUnique({ where: { id: params.orderId }, select: { id: true } }),
    prisma.driver.findFirst({
      where: { id: params.driverId, isActive: true },
      select: { id: true, planVersion: true }
    })
  ]);
  if (!orderExists) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Order not found")
    };
  }
  if (!driverExists) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Driver not found")
    };
  }
  if (driverExists.planVersion !== params.expectedPlanVersion) {
    return {
      success: false,
      error: createApiErrorV2(
        "PLAN_VERSION_CONFLICT",
        "Driver plan version is stale",
        { currentPlanVersion: driverExists.planVersion }
      )
    };
  }

  const locks = await acquireCommandLocks([
    `dispatch:lock:${params.driverId}`,
    `order:lock:${params.orderId}`
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another plan edit is in progress"
      )
    };
  }

  try {
    const occurredAt = new Date();
    const snapshot = await buildDispatchSnapshot({
      type: "ASSIGNMENT_EXECUTION_CHANGED",
      occurredAt: occurredAt.toISOString(),
      orderId: params.orderId,
      driverId: params.driverId
    });
    const preparedPlan = await prepareScopedDriverPlan({
      snapshot,
      driverId: params.driverId,
      traceId: params.traceId,
      insertedOrderId: params.orderId,
      validationField: "driverId"
    });
    if (!preparedPlan.success) return preparedPlan;
    const plannedAssignment = preparedPlan.plan.assignments.find(
      (assignment) =>
        assignment.assignmentId === null && assignment.orderId === params.orderId
    );
    if (!plannedAssignment || !isCompletePlan(plannedAssignment)) {
      return {
        success: false,
        error: dependencyUnavailable("ETA calculation is unavailable")
      };
    }
    const plannedOrder = snapshot.orders.find(
      (order) => order.orderId === params.orderId
    );

    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: AssignResult & { success: true }; eventId: string }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver"
        WHERE "id" = ${params.driverId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${params.orderId}
        FOR UPDATE
      `;

      const [driver, order] = await Promise.all([
        tx.driver.findFirst({
          where: { id: params.driverId, isActive: true },
          select: {
            id: true,
            name: true,
            onShift: true,
            availability: true,
            planVersion: true
          }
        }),
        tx.order.findUnique({
          where: { id: params.orderId },
          select: {
            id: true,
            orderNo: true,
            executionStatus: true,
            promisedPickupAt: true,
            pickupAddress: true,
            pickupLat: true,
            pickupLng: true,
            deliveryAddress: true,
            deliveryLat: true,
            deliveryLng: true,
            currentAssignment: {
              select: {
                id: true,
                driverId: true,
                status: true,
                lockType: true
              }
            }
          }
        })
      ]);
      if (!driver) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Driver not found")
        };
      }
      if (!order) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Order not found")
        };
      }
      if (
        driver.planVersion !== params.expectedPlanVersion ||
        preparedPlan.plan.expectedPlanVersion !== driver.planVersion
      ) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "PLAN_VERSION_CONFLICT",
            "Driver plan version is stale",
            { currentPlanVersion: driver.planVersion }
          )
        };
      }
      if (order.executionStatus !== "UNASSIGNED") {
        return {
          kind: "rejected",
          error: illegalTransition(order.executionStatus, "PLANNED")
        };
      }
      if (
        !plannedOrder ||
        order.promisedPickupAt.getTime() !==
          new Date(plannedOrder.promisedPickupAt).getTime() ||
        order.pickupAddress !== plannedOrder.pickupAddress ||
        order.pickupLat !== (plannedOrder.pickupLocation?.lat ?? null) ||
        order.pickupLng !== (plannedOrder.pickupLocation?.lng ?? null) ||
        order.deliveryAddress !== plannedOrder.deliveryAddress ||
        order.deliveryLat !== (plannedOrder.deliveryLocation?.lat ?? null) ||
        order.deliveryLng !== (plannedOrder.deliveryLocation?.lng ?? null)
      ) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Order changed while planning; refresh and retry"
          )
        };
      }
      if (!driver.onShift || driver.availability !== "AVAILABLE") {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "VALIDATION_FAILED",
            "Driver must be on shift and available",
            { fields: { driverId: ["Driver must be on shift and available"] } }
          )
        };
      }

      const planApplied = await applyPreparedDriverPlan({
        tx,
        plan: preparedPlan.plan,
        insertedOrderId: order.id
      });
      if (!planApplied) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Driver plan changed; refresh and retry"
          )
        };
      }

      const assignment = await tx.assignment.create({
        data: {
          orderId: order.id,
          driverId: driver.id,
          type: "MANUAL_ASSIGN",
          status: "ACTIVE",
          createdByUserId: params.operatorUserId,
          lockType: "MANUAL_LOCKED",
          ...toPlanWriteData(plannedAssignment, preparedPlan.plan.calculatedAt)
        },
        select: { id: true }
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          executionStatus: "PLANNED",
          status: "ASSIGNED",
          currentAssignmentId: assignment.id,
          driverNameSnapshot: driver.name
        }
      });
      const nextPlanVersion = driver.planVersion + 1;
      await tx.driver.update({
        where: { id: driver.id },
        data: { status: "S3", planVersion: nextPlanVersion }
      });
      await tx.operationLog.create({
        data: {
          entityType: "ASSIGNMENT",
          entityId: assignment.id,
          action: "ASSIGN",
          operatorUserId: params.operatorUserId,
          orderId: order.id,
          driverId: driver.id,
          assignmentId: assignment.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            orderNo: order.orderNo,
            sequenceNo: plannedAssignment.sequenceNo,
            lockType: "MANUAL_LOCKED",
            expectedPlanVersion: params.expectedPlanVersion,
            nextPlanVersion,
            plan: preparedPlan.plan.assignments.map((planned) => ({
              assignmentId: planned.assignmentId,
              orderId: planned.orderId,
              sequenceNo: planned.sequenceNo
            }))
          }
        }
      });

      const eventId = `assignment-assigned:${order.id}:${driver.id}:${nextPlanVersion}`;
      await triggerAssignmentAssigned({
        tx,
        eventId,
        assignmentId: assignment.id,
        orderId: order.id,
        driverId: driver.id,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });
      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            assignmentId: assignment.id,
            orderId: order.id,
            driverId: driver.id,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }
    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(transactionResult.eventId, params.traceId);
    }
    return transactionResult.data;
  } catch (error) {
    log.error("assignment_manual_assign_failed", {
      orderId: params.orderId,
      driverId: params.driverId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Manual assignment failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

export async function withdrawAssignment(params: {
  assignmentId: string;
  reason: string;
  expectedPlanVersion: number;
  operatorUserId: string;
  traceId: string;
}): Promise<WithdrawResult> {
  const preflight = await prisma.assignment.findUnique({
    where: { id: params.assignmentId },
    select: { orderId: true, driverId: true }
  });
  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Assignment not found")
    };
  }
  const locks = await acquireCommandLocks([
    `dispatch:lock:${preflight.driverId}`,
    `order:lock:${preflight.orderId}`
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another plan edit is in progress"
      )
    };
  }

  try {
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: WithdrawResult & { success: true }; eventId: string }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver" WHERE "id" = ${preflight.driverId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${preflight.orderId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Assignment" WHERE "id" = ${params.assignmentId} FOR UPDATE
      `;
      const assignment = await tx.assignment.findUnique({
        where: { id: params.assignmentId },
        include: {
          driver: { select: { planVersion: true } },
          order: {
            select: { currentAssignmentId: true, executionStatus: true }
          }
        }
      });
      if (!assignment) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Assignment not found")
        };
      }
      if (assignment.driver.planVersion !== params.expectedPlanVersion) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "PLAN_VERSION_CONFLICT",
            "Driver plan version is stale",
            { currentPlanVersion: assignment.driver.planVersion }
          )
        };
      }
      if (
        assignment.order.currentAssignmentId !== assignment.id ||
        !["ACTIVE", "ACCEPTED"].includes(assignment.status) ||
        assignment.order.executionStatus !== "PLANNED"
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(
            assignment.order.executionStatus,
            "UNASSIGNED"
          )
        };
      }

      const occurredAt = new Date();
      await tx.assignment.update({
        where: { id: assignment.id },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: occurredAt,
          sequenceNo: null,
          lockType: "NONE"
        }
      });
      await tx.order.update({
        where: { id: assignment.orderId },
        data: {
          executionStatus: "UNASSIGNED",
          status: "PENDING",
          currentAssignmentId: null
        }
      });
      const nextPlanVersion = assignment.driver.planVersion + 1;
      await tx.driver.update({
        where: { id: assignment.driverId },
        data: { status: "S1", planVersion: nextPlanVersion }
      });
      await tx.operationLog.create({
        data: {
          entityType: "ASSIGNMENT",
          entityId: assignment.id,
          action: "WITHDRAW",
          operatorUserId: params.operatorUserId,
          orderId: assignment.orderId,
          driverId: assignment.driverId,
          assignmentId: assignment.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            beforeExecutionStatus: "PLANNED",
            afterExecutionStatus: "UNASSIGNED",
            expectedPlanVersion: params.expectedPlanVersion,
            nextPlanVersion
          }
        }
      });
      const eventId = `assignment-withdrawn:${assignment.id}:${nextPlanVersion}`;
      await triggerAssignmentWithdrawn({
        tx,
        eventId,
        assignmentId: assignment.id,
        orderId: assignment.orderId,
        driverId: assignment.driverId,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });
      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            assignmentId: assignment.id,
            orderId: assignment.orderId,
            driverId: assignment.driverId,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }
    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(transactionResult.eventId, params.traceId);
    }
    return transactionResult.data;
  } catch (error) {
    log.error("assignment_withdraw_failed", {
      assignmentId: params.assignmentId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Assignment withdrawal failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

export async function unlockAssignment(params: {
  assignmentId: string;
  reason: string;
  expectedPlanVersion: number;
  operatorUserId: string;
  traceId: string;
}): Promise<UnlockResult> {
  const preflight = await prisma.assignment.findUnique({
    where: { id: params.assignmentId },
    select: { orderId: true, driverId: true }
  });
  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Assignment not found")
    };
  }
  const locks = await acquireCommandLocks([
    `dispatch:lock:${preflight.driverId}`,
    `order:lock:${preflight.orderId}`
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another plan edit is in progress"
      )
    };
  }

  try {
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: UnlockResult & { success: true }; eventId: string }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver" WHERE "id" = ${preflight.driverId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${preflight.orderId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Assignment" WHERE "id" = ${params.assignmentId} FOR UPDATE
      `;
      const assignment = await tx.assignment.findUnique({
        where: { id: params.assignmentId },
        include: {
          driver: { select: { planVersion: true } },
          order: {
            select: { currentAssignmentId: true, executionStatus: true }
          }
        }
      });
      if (!assignment) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Assignment not found")
        };
      }
      if (assignment.driver.planVersion !== params.expectedPlanVersion) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "PLAN_VERSION_CONFLICT",
            "Driver plan version is stale",
            { currentPlanVersion: assignment.driver.planVersion }
          )
        };
      }
      if (
        assignment.order.currentAssignmentId !== assignment.id ||
        !["ACTIVE", "ACCEPTED"].includes(assignment.status) ||
        assignment.order.executionStatus !== "PLANNED"
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(
            assignment.order.executionStatus,
            "PLANNED"
          )
        };
      }
      if (assignment.lockType !== "MANUAL_LOCKED") {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "VALIDATION_FAILED",
            "Assignment is not manually locked",
            { fields: { assignmentId: ["Assignment is not manually locked"] } }
          )
        };
      }

      const occurredAt = new Date();
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { lockType: "NONE" }
      });
      const nextPlanVersion = assignment.driver.planVersion + 1;
      await tx.driver.update({
        where: { id: assignment.driverId },
        data: { planVersion: nextPlanVersion }
      });
      await tx.operationLog.create({
        data: {
          entityType: "ASSIGNMENT",
          entityId: assignment.id,
          action: "UNLOCK",
          operatorUserId: params.operatorUserId,
          orderId: assignment.orderId,
          driverId: assignment.driverId,
          assignmentId: assignment.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            beforeLockType: "MANUAL_LOCKED",
            afterLockType: "NONE",
            expectedPlanVersion: params.expectedPlanVersion,
            nextPlanVersion
          }
        }
      });
      const eventId = `assignment-unlocked:${assignment.id}:${nextPlanVersion}`;
      await enqueueInternalEvent(tx, {
        eventId,
        type: "ASSIGNMENT_UNLOCKED",
        assignmentId: assignment.id,
        orderId: assignment.orderId,
        driverId: assignment.driverId,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });
      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            assignmentId: assignment.id,
            orderId: assignment.orderId,
            driverId: assignment.driverId,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }
    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(transactionResult.eventId, params.traceId);
    }
    return transactionResult.data;
  } catch (error) {
    log.error("assignment_unlock_failed", {
      assignmentId: params.assignmentId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Assignment unlock failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

import { randomUUID } from "node:crypto";

import type { OrderExecutionStatus, Prisma } from "@prisma/client";

import { createApiErrorV2 } from "@/lib/contracts/v2";
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

import type { ApiErrorV2 } from "@/types/v2";

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
              executionStatus: true
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
        assignment.driver.planVersion !== params.expectedFromPlanVersion ||
        targetDriver.planVersion !== params.expectedToPlanVersion
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

      const occurredAt = new Date();
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
          lockType: "MANUAL_LOCKED"
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
            nextToPlanVersion
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
      select: { id: true }
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
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: AssignResult & { success: true }; eventId: string }
      | { kind: "replayed"; data: AssignResult & { success: true } }
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
            planVersion: true,
            assignments: {
              where: {
                status: { in: ["ACTIVE", "ACCEPTED"] },
                order: {
                  executionStatus: { notIn: ["COMPLETED", "CANCELLED"] }
                }
              },
              select: { sequenceNo: true }
            }
          }
        }),
        tx.order.findUnique({
          where: { id: params.orderId },
          select: {
            id: true,
            orderNo: true,
            executionStatus: true,
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
        order.executionStatus === "PLANNED" &&
        order.currentAssignment?.driverId === driver.id &&
        order.currentAssignment.lockType === "MANUAL_LOCKED" &&
        ["ACTIVE", "ACCEPTED"].includes(order.currentAssignment.status)
      ) {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: {
              assignmentId: order.currentAssignment.id,
              orderId: order.id,
              driverId: driver.id,
              planVersion: driver.planVersion,
              replayed: true
            }
          }
        };
      }
      if (order.executionStatus !== "UNASSIGNED") {
        return {
          kind: "rejected",
          error: illegalTransition(order.executionStatus, "PLANNED")
        };
      }
      if (driver.planVersion !== params.expectedPlanVersion) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "PLAN_VERSION_CONFLICT",
            "Driver plan version is stale",
            { currentPlanVersion: driver.planVersion }
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

      const occupied = new Set(
        driver.assignments
          .map((assignment) => assignment.sequenceNo)
          .filter((sequenceNo): sequenceNo is number => sequenceNo !== null)
      );
      const sequenceNo = [1, 2, 3].find((candidate) => !occupied.has(candidate));
      if (!sequenceNo) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "VALIDATION_FAILED",
            "Driver has no available A/B/C slot",
            { fields: { driverId: ["No available plan slot"] } }
          )
        };
      }

      const occurredAt = new Date();
      const assignment = await tx.assignment.create({
        data: {
          orderId: order.id,
          driverId: driver.id,
          type: "MANUAL_ASSIGN",
          status: "ACTIVE",
          createdByUserId: params.operatorUserId,
          sequenceNo,
          lockType: "MANUAL_LOCKED"
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
            sequenceNo,
            lockType: "MANUAL_LOCKED",
            expectedPlanVersion: params.expectedPlanVersion,
            nextPlanVersion
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
      | { kind: "replayed"; data: WithdrawResult & { success: true } }
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
      if (
        assignment.status === "WITHDRAWN" &&
        assignment.order.executionStatus === "UNASSIGNED"
      ) {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: {
              assignmentId: assignment.id,
              orderId: assignment.orderId,
              driverId: assignment.driverId,
              planVersion: assignment.driver.planVersion,
              replayed: true
            }
          }
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
      | { kind: "replayed"; data: UnlockResult & { success: true } }
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
      if (
        assignment.lockType === "NONE" &&
        assignment.order.currentAssignmentId === assignment.id &&
        assignment.order.executionStatus === "PLANNED"
      ) {
        const priorUnlock = await tx.operationLog.findFirst({
          where: { assignmentId: assignment.id, action: "UNLOCK" },
          select: { id: true }
        });
        if (priorUnlock) {
          return {
            kind: "replayed",
            data: {
              success: true,
              data: {
                assignmentId: assignment.id,
                orderId: assignment.orderId,
                driverId: assignment.driverId,
                planVersion: assignment.driver.planVersion,
                replayed: true
              }
            }
          };
        }
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

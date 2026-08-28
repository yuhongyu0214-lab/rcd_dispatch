import { randomUUID } from "crypto";

import type { Assignment, DriverShift, Prisma } from "@prisma/client";

import type { ApiErrorV2 } from "@/types/v2";

import { SYSTEM_ROLES } from "@/lib/auth/roles";
import { createApiErrorV2 } from "@/lib/contracts/v2";
import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireResourceLock, releaseResourceLock } from "@/lib/redis";

import type { ShiftResult } from "./types";

const log = createLogger("shifts");

async function resolveSystemOperator(
  tx: Prisma.TransactionClient
): Promise<string> {
  const operator = await tx.user.findFirst({
    where: { role: { in: [...SYSTEM_ROLES] } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!operator) throw new Error("SYSTEM_OPERATOR_NOT_CONFIGURED");
  return operator.id;
}

async function writeShiftAuditLog(
  tx: Prisma.TransactionClient,
  params: {
    action: "SHIFT_START" | "SHIFT_END";
    shiftId: string;
    driverId: string;
    traceId: string;
    occurredAt: Date;
  }
) {
  const operatorUserId = await resolveSystemOperator(tx);
  await tx.operationLog.create({
    data: {
      entityType: "DRIVER_SHIFT",
      entityId: params.shiftId,
      action: params.action,
      operatorUserId,
      driverId: params.driverId,
      traceId: params.traceId,
      reason:
        params.action === "SHIFT_START"
          ? "Driver shift started"
          : "Driver shift ended",
      metadataJson: {
        shiftId: params.shiftId,
        driverId: params.driverId,
        actor: "DRIVER_API",
        occurredAt: params.occurredAt.toISOString()
      }
    }
  });
  return operatorUserId;
}

/** Internal outcome of the endShift transaction. */
type EndShiftTxOutcome =
  | {
      kind: "completed";
      shift: DriverShift;
      releasedCount: number;
      dispatchEventId: string;
    }
  | { kind: "missing_shift_repaired" }
  | { kind: "rejected"; error: ApiErrorV2 };

/**
 * Start a driver shift.
 *
 * Rule 8:
 * - Creates a DriverShift record with the current timestamp
 * - Sets driver.onShift = true
 * - Increments driver.planVersion (API contract §1.6)
 *
 * Concurrency: acquires a short Redis lock per driver (API contract §1.6),
 * with a DB conditional update as the final guard when Redis is degraded.
 * Idempotent: if the driver is already on shift, returns the current active
 * shift without creating a new one (API contract §15).
 */
export async function startShift(
  driverId: string,
  traceId: string
): Promise<ShiftResult> {
  const lockKey = `dispatch:lock:${driverId}`;
  const lockToken = randomUUID();
  const lockResult = await acquireResourceLock(lockKey, lockToken, 15);
  if (lockResult === "busy") {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another shift operation is in progress for this driver"
      )
    };
  }

  try {
    // Check idempotency outside the transaction first (cheap read)
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, isActive: true, onShift: true }
    });

    if (!driver || !driver.isActive) {
      return {
        success: false,
        error: createApiErrorV2("NOT_FOUND", "Driver not found or inactive")
      };
    }

    if (driver.onShift) {
      const activeShift = await prisma.driverShift.findFirst({
        where: { driverId, endedAt: null },
        orderBy: { startedAt: "desc" }
      });

      if (activeShift) {
        log.info("Shift start idempotent — already on shift", {
          traceId,
          driverId,
          shiftId: activeShift.id
        });
        return { success: true, shift: activeShift };
      }

      // onShift=true but no open shift row — repair inside a transaction
      // so the state correction is atomic
      const result = await prisma.$transaction<
        | { kind: "repaired"; shift: DriverShift; dispatchEventId: string }
        | { kind: "not_found" }
      >(async (tx) => {
        const recheck = await tx.driver.findUnique({
          where: { id: driverId },
          select: { onShift: true, isActive: true }
        });
        if (!recheck?.isActive) return { kind: "not_found" as const };
        if (!recheck.onShift) return { kind: "not_found" as const };

        const repairedShift = await tx.driverShift.create({
          data: { driverId, startedAt: new Date() }
        });
        await writeShiftAuditLog(tx, {
          action: "SHIFT_START",
          shiftId: repairedShift.id,
          driverId,
          traceId,
          occurredAt: repairedShift.startedAt
        });
        const dispatchEventId = `driver-shift-started:${repairedShift.id}`;
        await enqueueInternalEvent(tx, {
          eventId: dispatchEventId,
          type: "DRIVER_SHIFT_STARTED",
          driverId,
          occurredAt: repairedShift.startedAt.toISOString(),
          traceId
        });
        return {
          kind: "repaired" as const,
          shift: repairedShift,
          dispatchEventId
        };
      });

      if (result.kind === "repaired") {
        log.warn(
          "Shift state repaired — onShift was true but no open shift row",
          {
            traceId,
            driverId,
            shiftId: result.shift.id
          }
        );
        await processDispatchEventBestEffort(result.dispatchEventId, traceId);
        return { success: true, shift: result.shift };
      }
      return {
        success: false,
        error: createApiErrorV2("NOT_FOUND", "Driver not found or inactive")
      };
    }

    // Normal flow: conditional update + shift create in one transaction
    const result = await prisma.$transaction<
      | {
          kind: "created";
          shift: DriverShift;
          dispatchEventId: string;
        }
      | { kind: "race_lost" }
    >(async (tx) => {
      const claim = await tx.driver.updateMany({
        where: { id: driverId, isActive: true, onShift: false },
        data: {
          onShift: true,
          planVersion: { increment: 1 }
        }
      });

      if (claim.count !== 1) {
        return { kind: "race_lost" };
      }

      const shift = await tx.driverShift.create({
        data: { driverId, startedAt: new Date() }
      });
      await writeShiftAuditLog(tx, {
        action: "SHIFT_START",
        shiftId: shift.id,
        driverId,
        traceId,
        occurredAt: shift.startedAt
      });

      const dispatchEventId = `driver-shift-started:${shift.id}`;
      await enqueueInternalEvent(tx, {
        eventId: dispatchEventId,
        type: "DRIVER_SHIFT_STARTED",
        driverId,
        occurredAt: shift.startedAt.toISOString(),
        traceId
      });

      return { kind: "created", shift, dispatchEventId };
    });

    if (result.kind === "race_lost") {
      // Re-read to provide the idempotent response
      const activeShift = await prisma.driverShift.findFirst({
        where: { driverId, endedAt: null },
        orderBy: { startedAt: "desc" }
      });
      if (activeShift) {
        log.info(
          "Shift start idempotent — concurrent claim lost, reusing open shift",
          {
            traceId,
            driverId,
            shiftId: activeShift.id
          }
        );
        return { success: true, shift: activeShift };
      }
      return {
        success: false,
        error: createApiErrorV2("NOT_FOUND", "Driver not found or inactive")
      };
    }

    log.info("Shift started", { traceId, driverId, shiftId: result.shift.id });
    await processDispatchEventBestEffort(result.dispatchEventId, traceId);
    return { success: true, shift: result.shift };
  } finally {
    if (lockResult === "acquired") {
      await releaseResourceLock(lockKey, lockToken);
    }
  }
}

/**
 * End a driver shift.
 *
 * The entire flow — driver guard checks, PLANNED-assignment release, shift
 * close and driver update — runs inside a single transaction, so it either
 * all commits or all rolls back. Running the guards inside the transaction
 * also prevents TOCTOU between the EN_ROUTE/IN_SERVICE check and the writes.
 *
 * The active shift check happens BEFORE PLANNED release (P1-1 fix):
 * if no open shift is found, only driver.onShift is repaired and a NOT_FOUND
 * is returned — no assignments are released.
 *
 * A short Redis lock per driver serialises endShift against concurrent
 * depart/start (API contract §1.6). On success, planVersion is always
 * incremented exactly once (whether or not PLANNED assignments were released).
 *
 * Guards (rules 9-10):
 * - Cannot end shift if driver has active assignments with order executionStatus
 *   of EN_ROUTE or IN_SERVICE → returns ILLEGAL_TRANSITION
 * - PLANNED assignments are released: assignment RECYCLED with sequenceNo
 *   cleared, order reset to UNASSIGNED with currentAssignmentId cleared,
 *   and an OperationLog written per release
 * - EN_ROUTE / IN_SERVICE orders are NOT touched
 *
 * After guards pass:
 * - Closes the active DriverShift (sets endedAt)
 * - Sets driver.onShift = false
 */
export async function endShift(
  driverId: string,
  traceId: string
): Promise<ShiftResult> {
  const lockKey = `dispatch:lock:${driverId}`;
  const lockToken = randomUUID();
  const lockResult = await acquireResourceLock(lockKey, lockToken, 15);
  if (lockResult === "busy") {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another shift operation is in progress for this driver"
      )
    };
  }

  try {
    let outcome: EndShiftTxOutcome;

    try {
      outcome = await prisma.$transaction<EndShiftTxOutcome>(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "Driver"
            WHERE "id" = ${driverId}
            FOR UPDATE
          `;

          const driver = await tx.driver.findUnique({
            where: { id: driverId },
            select: { id: true, onShift: true, planVersion: true }
          });

          if (!driver) {
            return {
              kind: "rejected",
              error: createApiErrorV2("NOT_FOUND", "Driver not found")
            };
          }

          if (!driver.onShift) {
            return {
              kind: "rejected",
              error: createApiErrorV2(
                "ILLEGAL_TRANSITION",
                "Driver is not on shift",
                {
                  currentStatus: "UNASSIGNED",
                  targetStatus: "COMPLETED"
                }
              )
            };
          }

          // P1-1 fix: check for the active shift FIRST.
          // If absent, only repair the onShift flag — do NOT release
          // PLANNED assignments.
          const activeShift = await tx.driverShift.findFirst({
            where: { driverId, endedAt: null },
            orderBy: { startedAt: "desc" }
          });

          if (!activeShift) {
            // State inconsistency: onShift === true but no open shift
            await tx.driver.update({
              where: { id: driverId },
              data: {
                onShift: false,
                planVersion: driver.planVersion + 1
              }
            });
            return { kind: "missing_shift_repaired" };
          }

          // Guard: check for EN_ROUTE or IN_SERVICE orders (rule 9) —
          // inside the transaction to avoid TOCTOU with the writes below.
          const blockingAssignments = await tx.assignment.findMany({
            where: {
              driverId,
              status: { in: ["ACTIVE", "ACCEPTED"] },
              order: {
                executionStatus: { in: ["EN_ROUTE", "IN_SERVICE"] }
              }
            },
            select: {
              id: true,
              orderId: true,
              order: { select: { executionStatus: true } }
            }
          });

          if (blockingAssignments.length > 0) {
            const blockingStatus = blockingAssignments.some(
              (assignment) =>
                assignment.order.executionStatus === "IN_SERVICE"
            )
              ? "IN_SERVICE"
              : "EN_ROUTE";
            return {
              kind: "rejected",
              error: createApiErrorV2(
                "ILLEGAL_TRANSITION",
                "Cannot end shift with active EN_ROUTE or IN_SERVICE orders",
                {
                  currentStatus: blockingStatus,
                  targetStatus: "UNASSIGNED"
                }
              )
            };
          }

          // Release PLANNED assignments (rule 10)
          const plannedAssignments = await tx.assignment.findMany({
            where: {
              driverId,
              status: { in: ["ACTIVE", "ACCEPTED"] },
              order: {
                executionStatus: "PLANNED"
              }
            },
            select: { id: true, orderId: true }
          });

          let operatorUserId: string;
          try {
            operatorUserId = await resolveSystemOperator(tx);
          } catch {
            return {
              kind: "rejected",
              error: createApiErrorV2(
                "INTERNAL_ERROR",
                "No system operator account available to log the shift change"
              )
            };
          }

          if (plannedAssignments.length > 0) {
            const releasedAt = new Date();

            for (const assignment of plannedAssignments) {
              // Remove from plan and close out the assignment
              await tx.assignment.update({
                where: { id: assignment.id },
                data: {
                  status: "RECYCLED",
                  recycledAt: releasedAt,
                  sequenceNo: null
                }
              });

              // Reset order to UNASSIGNED and detach the released assignment
              await tx.order.update({
                where: { id: assignment.orderId },
                data: {
                  executionStatus: "UNASSIGNED",
                  currentAssignmentId: null
                }
              });

              // Audit every release in the same transaction
              await tx.operationLog.create({
                data: {
                  entityType: "ASSIGNMENT",
                  entityId: assignment.id,
                  action: "RECYCLE",
                  operatorUserId,
                  orderId: assignment.orderId,
                  driverId,
                  assignmentId: assignment.id,
                  traceId,
                  reason: "Released PLANNED assignment on shift end",
                  metadataJson: {
                    traceId,
                    actor: "DRIVER_API",
                    trigger: "SHIFT_END",
                    orderId: assignment.orderId,
                    assignmentId: assignment.id,
                    driverId,
                    stateFlow: ["PLANNED", "UNASSIGNED"]
                  }
                }
              });
            }
          }

          // Close the active shift
          const closedShift = await tx.driverShift.update({
            where: { id: activeShift.id },
            data: { endedAt: new Date() }
          });
          await tx.operationLog.create({
            data: {
              entityType: "DRIVER_SHIFT",
              entityId: closedShift.id,
              action: "SHIFT_END",
              operatorUserId,
              driverId,
              traceId,
              reason: "Driver shift ended",
              metadataJson: {
                shiftId: closedShift.id,
                driverId,
                actor: "DRIVER_API",
                occurredAt: closedShift.endedAt!.toISOString(),
                releasedAssignmentCount: plannedAssignments.length
              }
            }
          });

          // Assignment compatibility triggers may increment planVersion once
          // per released row. Reset it to the aggregate command's single
          // version step while the driver row remains locked.
          await tx.driver.update({
            where: { id: driverId },
            data: {
              onShift: false,
              planVersion: driver.planVersion + 1
            }
          });

          const dispatchEventId = `driver-shift-ended:${closedShift.id}`;
          await enqueueInternalEvent(tx, {
            eventId: dispatchEventId,
            type: "DRIVER_SHIFT_ENDED",
            driverId,
            occurredAt: closedShift.endedAt!.toISOString(),
            traceId
          });

          return {
            kind: "completed",
            shift: closedShift,
            releasedCount: plannedAssignments.length,
            dispatchEventId
          };
        },
        { timeout: 10_000 }
      );
    } catch (error) {
      // Any throw inside the callback rolled the whole transaction back —
      // no partial state (e.g. released assignments without a closed shift).
      log.error("endShift transaction failed — rolled back", {
        traceId,
        driverId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: createApiErrorV2(
          "INTERNAL_ERROR",
          "Failed to end shift — no changes were applied"
        )
      };
    }

    if (outcome.kind === "rejected") {
      return { success: false, error: outcome.error };
    }

    if (outcome.kind === "missing_shift_repaired") {
      log.warn("No active shift found on endShift — driver.onShift was true", {
        traceId,
        driverId
      });
      return {
        success: false,
        error: createApiErrorV2("NOT_FOUND", "No active shift found")
      };
    }

    if (outcome.releasedCount > 0) {
      log.info("Released PLANNED assignments on shift end", {
        traceId,
        driverId,
        count: outcome.releasedCount
      });
    }

    log.info("Shift ended", {
      traceId,
      driverId,
      shiftId: outcome.shift.id,
      releasedPlanned: outcome.releasedCount
    });

    await processDispatchEventBestEffort(outcome.dispatchEventId, traceId);
    return { success: true, shift: outcome.shift };
  } finally {
    if (lockResult === "acquired") {
      await releaseResourceLock(lockKey, lockToken);
    }
  }
}

async function processDispatchEventBestEffort(
  eventId: string,
  traceId: string
) {
  try {
    await processInternalEvent(eventId);
  } catch (error) {
    log.error("Shift dispatch event processing failed; outbox retained", {
      eventId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Return all active assignments for a driver where the order executionStatus
 * is PLANNED (i.e. assigned to the plan but not yet departed).
 */
export async function getActivePlannedAssignments(
  driverId: string
): Promise<Assignment[]> {
  return prisma.assignment.findMany({
    where: {
      driverId,
      status: { in: ["ACTIVE", "ACCEPTED"] },
      order: {
        executionStatus: "PLANNED"
      }
    },
    include: { order: true }
  });
}

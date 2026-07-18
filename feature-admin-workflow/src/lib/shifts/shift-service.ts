import type { Assignment, DriverShift } from "@prisma/client";

import type { ApiErrorV2 } from "@/types/v2";

import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createApiErrorV2 } from "@/lib/contracts/v2";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type { ShiftResult } from "./types";

const log = createLogger("shifts");

/** Internal outcome of the endShift transaction. */
type EndShiftTxOutcome =
  | { kind: "completed"; shift: DriverShift; releasedCount: number }
  | { kind: "missing_shift_repaired" }
  | { kind: "rejected"; error: ApiErrorV2 };

/**
 * Start a driver shift.
 *
 * Rule 8:
 * - Creates a DriverShift record with the current timestamp
 * - Sets driver.onShift = true
 * - Sets driver.availability = AVAILABLE
 *
 * Idempotent: if the driver is already on shift, returns the current active shift
 * (API contract §15).
 */
export async function startShift(
  driverId: string,
  traceId: string
): Promise<ShiftResult> {
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

  // Idempotent — already on shift (API contract §15)
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

    // Edge case: onShift === true but no open shift row — repair state
    const repairedShift = await prisma.driverShift.create({
      data: { driverId, startedAt: new Date() }
    });

    log.warn("Shift state repaired — onShift was true but no open shift row", {
      traceId,
      driverId,
      shiftId: repairedShift.id
    });

    return { success: true, shift: repairedShift };
  }

  // Normal flow: create shift and update driver
  const shift = await prisma.driverShift.create({
    data: { driverId, startedAt: new Date() }
  });

  await prisma.driver.update({
    where: { id: driverId },
    data: { onShift: true, availability: "AVAILABLE" }
  });

  log.info("Shift started", { traceId, driverId, shiftId: shift.id });

  return { success: true, shift };
}

/**
 * End a driver shift.
 *
 * P0-2: the entire flow — guard checks, PLANNED-assignment release, shift
 * close and driver update — runs inside a single transaction, so it either
 * all commits or all rolls back. Running the guards inside the transaction
 * also prevents TOCTOU between the EN_ROUTE/IN_SERVICE check and the writes.
 *
 * Guards (rules 9-10):
 * - Cannot end shift if driver has active assignments with order executionStatus
 *   of EN_ROUTE or IN_SERVICE → returns ILLEGAL_TRANSITION
 * - PLANNED assignments are released: assignment RECYCLED with sequenceNo
 *   cleared, order reset to UNASSIGNED with currentAssignmentId cleared,
 *   driver planVersion incremented, and an OperationLog written per release
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
  let outcome: EndShiftTxOutcome;

  try {
    outcome = await prisma.$transaction<EndShiftTxOutcome>(
      async (tx) => {
        const driver = await tx.driver.findUnique({
          where: { id: driverId },
          select: { id: true, onShift: true }
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

        // Guard: check for EN_ROUTE or IN_SERVICE orders (rule 9) —
        // inside the transaction to avoid TOCTOU with the writes below.
        const blockingAssignments = await tx.assignment.findMany({
          where: {
            driverId,
            status: "ACTIVE",
            order: {
              executionStatus: { in: ["EN_ROUTE", "IN_SERVICE"] }
            }
          },
          select: { id: true, orderId: true }
        });

        if (blockingAssignments.length > 0) {
          return {
            kind: "rejected",
            error: createApiErrorV2(
              "ILLEGAL_TRANSITION",
              "Cannot end shift with active EN_ROUTE or IN_SERVICE orders",
              {
                currentStatus: "IN_SERVICE",
                targetStatus: "UNASSIGNED"
              }
            )
          };
        }

        // Release PLANNED assignments (rule 10)
        const plannedAssignments = await tx.assignment.findMany({
          where: {
            driverId,
            status: "ACTIVE",
            order: {
              executionStatus: "PLANNED"
            }
          },
          select: { id: true, orderId: true }
        });

        if (plannedAssignments.length > 0) {
          // OperationLog requires an operator user; driver-triggered releases
          // are logged under the earliest admin/dispatcher (system operator).
          const operator = await tx.user.findFirst({
            where: { role: { in: [...ADMIN_ROLES] } },
            orderBy: { createdAt: "asc" },
            select: { id: true }
          });

          if (!operator) {
            return {
              kind: "rejected",
              error: createApiErrorV2(
                "INTERNAL_ERROR",
                "No system operator account available to log the release"
              )
            };
          }

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
                operatorUserId: operator.id,
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

          // Plan changed — bump the driver's plan version
          await tx.driver.update({
            where: { id: driverId },
            data: { planVersion: { increment: 1 } }
          });
        }

        // Find and close the active shift
        const activeShift = await tx.driverShift.findFirst({
          where: { driverId, endedAt: null },
          orderBy: { startedAt: "desc" }
        });

        if (!activeShift) {
          // State inconsistency: onShift === true but no open shift
          await tx.driver.update({
            where: { id: driverId },
            data: { onShift: false }
          });
          return { kind: "missing_shift_repaired" };
        }

        const closedShift = await tx.driverShift.update({
          where: { id: activeShift.id },
          data: { endedAt: new Date() }
        });

        await tx.driver.update({
          where: { id: driverId },
          data: { onShift: false }
        });

        return {
          kind: "completed",
          shift: closedShift,
          releasedCount: plannedAssignments.length
        };
      },
      { timeout: 15_000 }
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

  return { success: true, shift: outcome.shift };
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
      status: "ACTIVE",
      order: {
        executionStatus: "PLANNED"
      }
    },
    include: { order: true }
  });
}

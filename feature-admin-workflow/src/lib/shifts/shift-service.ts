import type { Assignment } from "@prisma/client";

import { createApiErrorV2 } from "@/lib/contracts/v2";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type { ShiftResult } from "./types";

const log = createLogger("shifts");

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
 * Guards (rules 9-10):
 * - Cannot end shift if driver has active assignments with order executionStatus
 *   of EN_ROUTE or IN_SERVICE → returns ILLEGAL_TRANSITION
 * - PLANNED assignments are released: order executionStatus reset to UNASSIGNED
 *   and assignment sequenceNo removed (cleared from plan)
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
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, onShift: true }
  });

  if (!driver) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Driver not found")
    };
  }

  if (!driver.onShift) {
    return {
      success: false,
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

  // Guard: check for EN_ROUTE or IN_SERVICE orders (rule 9)
  const blockingAssignments = await prisma.assignment.findMany({
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
      success: false,
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
  const plannedAssignments = await prisma.assignment.findMany({
    where: {
      driverId,
      status: "ACTIVE",
      order: {
        executionStatus: "PLANNED"
      }
    },
    select: { id: true, orderId: true }
  });

  for (const assignment of plannedAssignments) {
    // Remove from plan
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { sequenceNo: null }
    });

    // Reset order to UNASSIGNED
    await prisma.order.update({
      where: { id: assignment.orderId },
      data: { executionStatus: "UNASSIGNED" }
    });
  }

  if (plannedAssignments.length > 0) {
    log.info("Released PLANNED assignments on shift end", {
      traceId,
      driverId,
      count: plannedAssignments.length
    });
  }

  // Find and close the active shift
  const activeShift = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null },
    orderBy: { startedAt: "desc" }
  });

  if (!activeShift) {
    // State inconsistency: onShift === true but no open shift
    await prisma.driver.update({
      where: { id: driverId },
      data: { onShift: false }
    });

    log.warn("No active shift found on endShift — driver.onShift was true", {
      traceId,
      driverId
    });

    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "No active shift found")
    };
  }

  const closedShift = await prisma.driverShift.update({
    where: { id: activeShift.id },
    data: { endedAt: new Date() }
  });

  await prisma.driver.update({
    where: { id: driverId },
    data: { onShift: false }
  });

  log.info("Shift ended", {
    traceId,
    driverId,
    shiftId: closedShift.id,
    releasedPlanned: plannedAssignments.length
  });

  return { success: true, shift: closedShift };
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

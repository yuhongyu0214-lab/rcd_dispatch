import { prisma } from "@/lib/prisma";
import type { EffectiveAssignmentRow } from "./types";

/**
 * Batch-read effective assignments for the given drivers.
 *
 * "Effective" means the assignment is currently active (not withdrawn / recycled
 * / completed / cancelled) AND the linked order has not reached a terminal
 * execution status.
 *
 * IMPORTANT: This function loads ALL effective assignments for every driver
 * in scope. It MUST NOT filter by a specific orderId — otherwise new-order
 * events would see an empty timeline and overwrite locked / in-service slots.
 */
export async function findEffectiveAssignments(params: {
  driverIds: string[];
}): Promise<EffectiveAssignmentRow[]> {
  const { driverIds } = params;

  if (driverIds.length === 0) return [];

  const rows = await prisma.assignment.findMany({
    where: {
      driverId: { in: driverIds },
      status: { in: ["ACTIVE", "ACCEPTED"] },
      order: {
        executionStatus: {
          notIn: ["COMPLETED", "CANCELLED"],
        },
      },
    },
    select: {
      id: true,
      orderId: true,
      driverId: true,
      type: true,
      status: true,
      sequenceNo: true,
      lockType: true,
      plannedDepartAt: true,
      plannedCompleteAt: true,
      order: {
        select: {
          executionStatus: true,
          pickupLat: true,
          pickupLng: true,
          deliveryLat: true,
          deliveryLng: true,
        },
      },
    },
    // Stable sort: driver first, then sequence within each driver.
    orderBy: [{ driverId: "asc" }, { sequenceNo: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    driverId: r.driverId,
    type: r.type,
    status: r.status,
    sequenceNo: r.sequenceNo,
    lockType: r.lockType,
    plannedDepartAt: r.plannedDepartAt,
    plannedCompleteAt: r.plannedCompleteAt,
    orderExecutionStatus: r.order.executionStatus,
    pickupLat: r.order.pickupLat,
    pickupLng: r.order.pickupLng,
    deliveryLat: r.order.deliveryLat,
    deliveryLng: r.order.deliveryLng,
  }));
}

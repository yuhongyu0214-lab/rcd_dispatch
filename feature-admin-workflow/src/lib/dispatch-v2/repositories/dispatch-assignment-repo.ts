import { prisma } from "@/lib/prisma";
import type { EffectiveAssignmentRow } from "./types";

/**
 * Batch-read effective assignments for the given drivers and orders.
 *
 * "Effective" means the assignment is currently active (not withdrawn / recycled
 * / completed / cancelled) AND the linked order has not reached a terminal
 * execution status.
 *
 * A non-empty `orderIds` list optionally narrows the result set (in-memory).
 */
export async function findEffectiveAssignments(params: {
  driverIds: string[];
  orderIds?: string[];
}): Promise<EffectiveAssignmentRow[]> {
  const { driverIds, orderIds } = params;

  // We query by driver ID scope (already bounded by affected stores).
  // If there are no drivers, there can be no assignments.
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
  });

  const mapped: EffectiveAssignmentRow[] = rows.map((r) => ({
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

  if (orderIds && orderIds.length > 0) {
    const idSet = new Set(orderIds);
    return mapped.filter((a) => idSet.has(a.orderId));
  }

  return mapped;
}

import { prisma } from "@/lib/prisma";
import type { DispatchableOrderRow } from "./types";
import type { Prisma } from "@prisma/client";

/**
 * Batch-read dispatchable orders for the given stores.
 *
 * Execution status filters (applied in the query):
 *   - COMPLETED  → excluded from the planning pool
 *   - CANCELLED  → excluded from the planning pool
 *   - UNASSIGNED / PLANNED / EN_ROUTE / IN_SERVICE → included
 *
 * When `requiredOrderIds` is provided, those order IDs are **added via OR**
 * to the store-scoped query. This is a UNION (not intersection): the result
 * includes ALL non-terminal orders in the given stores PLUS any orders named
 * by `requiredOrderIds` that aren't in those stores (cross-store assignments).
 */
export async function findDispatchableOrders(params: {
  storeIds: string[];
  requiredOrderIds?: string[];
}): Promise<DispatchableOrderRow[]> {
  const { storeIds, requiredOrderIds } = params;

  if (storeIds.length === 0 && (!requiredOrderIds || requiredOrderIds.length === 0)) {
    return [];
  }

  // Build OR union: (storeId ∈ storeIds) ∪ (id ∈ requiredOrderIds).
  // This guarantees every order referenced by a loaded assignment is present
  // even when the assignment's order belongs to a different store.
  const orParts: Prisma.OrderWhereInput[] = [];

  if (storeIds.length > 0) {
    orParts.push({ storeId: { in: storeIds } });
  }

  if (requiredOrderIds && requiredOrderIds.length > 0) {
    orParts.push({ id: { in: requiredOrderIds } });
  }

  const where: Prisma.OrderWhereInput = {
    executionStatus: { notIn: ["COMPLETED", "CANCELLED"] },
  };

  if (orParts.length === 1) {
    Object.assign(where, orParts[0]);
  } else {
    where.OR = orParts;
  }

  const rows = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNo: true,
      type: true,
      executionStatus: true,
      feasibility: true,
      slackMinutes: true,
      promisedPickupAt: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      currentAssignmentId: true,
      store: { select: { code: true } },
    },
    orderBy: [{ promisedPickupAt: "asc" }, { id: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    type: r.type,
    executionStatus: r.executionStatus,
    feasibility: r.feasibility,
    slackMinutes: r.slackMinutes,
    promisedPickupAt: r.promisedPickupAt,
    pickupAddress: r.pickupAddress,
    pickupLat: r.pickupLat,
    pickupLng: r.pickupLng,
    deliveryAddress: r.deliveryAddress,
    deliveryLat: r.deliveryLat,
    deliveryLng: r.deliveryLng,
    storeCode: r.store.code,
    currentAssignmentId: r.currentAssignmentId,
  }));
}

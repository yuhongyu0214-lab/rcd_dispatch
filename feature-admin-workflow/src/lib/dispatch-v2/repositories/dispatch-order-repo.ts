import { prisma } from "@/lib/prisma";
import type { DispatchableOrderRow } from "./types";

/**
 * Batch-read dispatchable orders for the given stores.
 *
 * Execution status filters (applied in the query):
 *   - COMPLETED  → excluded from the planning pool
 *   - CANCELLED  → excluded from the planning pool
 *   - UNASSIGNED / PLANNED / EN_ROUTE / IN_SERVICE → included
 *
 * If a non-empty `orderIds` list is provided, the result is further narrowed
 * to only those orders. This is an **in-memory filter** that cannot cause N+1
 * — the DB query already covers all candidate stores.
 */
export async function findDispatchableOrders(params: {
  storeIds: string[];
  orderIds?: string[];
}): Promise<DispatchableOrderRow[]> {
  const { storeIds, orderIds } = params;

  if (storeIds.length === 0) return [];

  const rows = await prisma.order.findMany({
    where: {
      storeId: { in: storeIds },
      executionStatus: {
        notIn: ["COMPLETED", "CANCELLED"],
      },
    },
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
    orderBy: { promisedPickupAt: "asc" },
  });

  const mapped: DispatchableOrderRow[] = rows.map((r) => ({
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

  if (orderIds && orderIds.length > 0) {
    const idSet = new Set(orderIds);
    return mapped.filter((o) => idSet.has(o.id));
  }

  return mapped;
}

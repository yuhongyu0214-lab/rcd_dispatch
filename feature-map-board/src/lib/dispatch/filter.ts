import type { DriverStatus, OrderType } from "@prisma/client";

import { DISPATCHABLE_DRIVER_STATUSES, isDoorOrder, isStoreOrder } from "./rules";
import type { DispatchCandidate, DispatchCoordinate, DriverActiveOrderCounts } from "./types";

export type DriverForDispatch = {
  id: string;
  name: string;
  status: DriverStatus;
  storeId: string;
  store: {
    id: string;
    name: string;
  };
  assignments: Array<{
    order: {
      type: OrderType;
    };
  }>;
};

export function countActiveOrders(
  assignments: Array<{
    order: {
      type: OrderType;
    };
  }>
): DriverActiveOrderCounts {
  return assignments.reduce(
    (result, assignment) => {
      if (isStoreOrder(assignment.order.type)) {
        result.store += 1;
      }

      if (isDoorOrder(assignment.order.type)) {
        result.door += 1;
      }

      return result;
    },
    { store: 0, door: 0 }
  );
}

export function filterDispatchCandidates(input: {
  orderType: OrderType;
  drivers: DriverForDispatch[];
  originsByDriverId: Map<string, DispatchCoordinate | null>;
}): DispatchCandidate[] {
  return input.drivers.flatMap((driver) => {
    if (!DISPATCHABLE_DRIVER_STATUSES.includes(driver.status)) {
      return [];
    }

    const activeOrders = countActiveOrders(driver.assignments);

    if (isDoorOrder(input.orderType) && activeOrders.door >= 1) {
      return [];
    }

    return [
      {
        driverId: driver.id,
        driverName: driver.name,
        driverStatus: driver.status,
        storeId: driver.store.id,
        storeName: driver.store.name,
        activeOrders,
        origin: input.originsByDriverId.get(driver.id) ?? null
      }
    ];
  });
}

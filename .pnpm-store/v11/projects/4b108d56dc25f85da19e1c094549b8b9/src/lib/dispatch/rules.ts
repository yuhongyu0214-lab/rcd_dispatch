import type { AssignmentStatus, DriverStatus, OrderType } from "@prisma/client";

export const STORE_ORDER_TYPES = new Set<OrderType>([
  "STORE_PICKUP",
  "STORE_RETURN"
]);

export const DOOR_ORDER_TYPES = new Set<OrderType>([
  "DOOR_DELIVERY",
  "DOOR_PICKUP"
]);

export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "ACTIVE",
  "ACCEPTED"
];

export const DISPATCHABLE_DRIVER_STATUSES: DriverStatus[] = [
  "S1",
  "S2",
  "S3",
  "S4"
];

export const ETA_EXCEEDED_MINUTES = 120;
export const STORE_ORDER_PENALTY_MINUTES = 7;

export function isStoreOrder(type: OrderType) {
  return STORE_ORDER_TYPES.has(type);
}

export function isDoorOrder(type: OrderType) {
  return DOOR_ORDER_TYPES.has(type);
}

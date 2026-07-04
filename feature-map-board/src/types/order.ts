export const ORDER_TYPES = [
  "STORE_PICKUP",
  "STORE_RETURN",
  "DOOR_DELIVERY",
  "DOOR_PICKUP"
] as const;

export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = [
  "PENDING",
  "RECOMMENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "RECYCLED",
  "CANCELLED"
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ASSIGNMENT_TYPES = [
  "MANUAL_ASSIGN",
  "RECOMMEND_ASSIGN",
  "REASSIGN"
] as const;

export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = [
  "ACTIVE",
  "ACCEPTED",
  "WITHDRAWN",
  "RECYCLED",
  "COMPLETED",
  "CANCELLED"
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const OPERATION_ENTITY_TYPES = [
  "ORDER",
  "ASSIGNMENT",
  "DRIVER",
  "VEHICLE",
  "IMPORT_BATCH"
] as const;

export type OperationEntityType = (typeof OPERATION_ENTITY_TYPES)[number];

export const OPERATION_ACTIONS = [
  "ASSIGN",
  "REASSIGN",
  "WITHDRAW",
  "RECYCLE",
  "CANCEL",
  "ACCEPT",
  "START",
  "COMPLETE",
  "IMPORT"
] as const;

export type OperationAction = (typeof OPERATION_ACTIONS)[number];

export type OrderRecord = {
  id: string;
  orderNo: string;
  type: OrderType;
  status: OrderStatus;
  storeId: string;
  vehicleId: string | null;
  licensePlateSnapshot: string | null;
  importBatchId: string | null;
  channel: string | null;
  driverNameSnapshot: string | null;
  vehicleTypeSnapshot: string | null;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  returnAddress: string;
  returnLat: number | null;
  returnLng: number | null;
  scheduledAt: Date;
  currentAssignmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AssignmentRecord = {
  id: string;
  orderId: string;
  driverId: string;
  type: AssignmentType;
  status: AssignmentStatus;
  previousAssignmentId: string | null;
  createdByUserId: string;
  assignedAt: Date;
  acceptedAt: Date | null;
  withdrawnAt: Date | null;
  recycledAt: Date | null;
  completedAt: Date | null;
};

export type OperationLogRecord = {
  id: string;
  entityType: OperationEntityType;
  entityId: string;
  action: OperationAction;
  operatorUserId: string;
  reason: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
};

export type OrderSummary = Pick<
  OrderRecord,
  "id" | "orderNo" | "type" | "status" | "storeId" | "scheduledAt"
> & {
  driverId?: string | null;
  vehicleLicensePlate?: string | null;
};

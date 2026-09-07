import type { IsoDateTimeStringV2 } from "./domain";

export const OPERATION_ENTITY_TYPES_V2 = [
  "ORDER",
  "ASSIGNMENT",
  "DRIVER",
  "VEHICLE",
  "IMPORT_BATCH",
  "ORDER_SOURCE_EVENT",
  "DRIVER_SHIFT",
  "SERVICE_PLAN",
  "DISPATCH_ALERT",
  "LOCATION_SAMPLE"
] as const;
export type OperationEntityTypeV2 =
  (typeof OPERATION_ENTITY_TYPES_V2)[number];

export const OPERATION_ACTIONS_V2 = [
  "ASSIGN",
  "REASSIGN",
  "WITHDRAW",
  "RECYCLE",
  "CANCEL",
  "ACCEPT",
  "START",
  "COMPLETE",
  "IMPORT",
  "AUTO_DISPATCH",
  "DEPART",
  "ARRIVE",
  "MODULE_CHANGE",
  "ORDER_MODIFY",
  "ALERT_RESOLVE",
  "SHIFT_START",
  "SHIFT_END",
  "UNLOCK",
  "AVAILABILITY_CHANGE"
] as const;
export type OperationActionV2 = (typeof OPERATION_ACTIONS_V2)[number];

export const OPERATION_LOG_CHANGE_FIELDS_V2 = [
  "alertStatus",
  "arrivedAt",
  "availability",
  "cancelledAt",
  "completedAt",
  "deliveryAddress",
  "deliveryLat",
  "deliveryLng",
  "departedAt",
  "driverId",
  "executionStatus",
  "feasibility",
  "lockType",
  "modules",
  "onShift",
  "pickupAddress",
  "pickupLat",
  "pickupLng",
  "planVersion",
  "promisedPickupAt",
  "resolvedBy",
  "sequenceNo",
  "shiftStartedAt",
  "slackMinutes",
  "slot",
  "sourceVersion"
] as const;
export type OperationLogChangeFieldV2 =
  (typeof OPERATION_LOG_CHANGE_FIELDS_V2)[number];

export type OperationLogScalarV2 = string | number | boolean | null;
export type OperationLogValueV2 =
  | OperationLogScalarV2
  | OperationLogScalarV2[];

export type OperationLogChangeV2 = {
  field: OperationLogChangeFieldV2;
  before: OperationLogValueV2;
  after: OperationLogValueV2;
};

export type OperationLogV2 = {
  id: string;
  entityType: OperationEntityTypeV2;
  entityId: string;
  action: OperationActionV2;
  operator: { id: string; name: string };
  reason: string | null;
  traceId: string | null;
  orderId?: string;
  driverId?: string;
  assignmentId?: string;
  changes: OperationLogChangeV2[];
  createdAt: IsoDateTimeStringV2;
};

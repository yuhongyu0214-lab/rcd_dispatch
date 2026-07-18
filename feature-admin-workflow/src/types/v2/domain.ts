export type IsoDateTimeStringV2 = string;

export type GeoPointV2 = {
  lat: number;
  lng: number;
};

export const ORDER_SOURCE_SYSTEMS_V2 = [
  "HALUO",
  "PLUGIN",
  "API",
  "V1_IMPORT"
] as const;
export type OrderSourceSystemV2 = (typeof ORDER_SOURCE_SYSTEMS_V2)[number];
export type OnlineOrderSourceSystemV2 = Exclude<
  OrderSourceSystemV2,
  "V1_IMPORT"
>;

export const BUSINESS_TYPES_V2 = [
  "STORE_PICKUP",
  "STORE_RETURN",
  "DOOR_DELIVERY",
  "DOOR_PICKUP"
] as const;
export type BusinessTypeV2 = (typeof BUSINESS_TYPES_V2)[number];

export const EXECUTION_STATUSES_V2 = [
  "UNASSIGNED",
  "PLANNED",
  "EN_ROUTE",
  "IN_SERVICE",
  "COMPLETED",
  "CANCELLED"
] as const;
export type ExecutionStatusV2 = (typeof EXECUTION_STATUSES_V2)[number];

export const ORDER_FEASIBILITIES_V2 = [
  "UNKNOWN",
  "NORMAL",
  "AT_RISK",
  "INFEASIBLE"
] as const;
export type OrderFeasibilityV2 = (typeof ORDER_FEASIBILITIES_V2)[number];

export const ASSIGNMENT_LOCK_TYPES_V2 = [
  "NONE",
  "AUTO_FROZEN",
  "MANUAL_LOCKED"
] as const;
export type AssignmentLockTypeV2 = (typeof ASSIGNMENT_LOCK_TYPES_V2)[number];

export const ASSIGNMENT_SLOTS_V2 = ["NONE", "A", "B", "C"] as const;
export type AssignmentSlotV2 = (typeof ASSIGNMENT_SLOTS_V2)[number];
export type PlannedAssignmentSlotV2 = Exclude<AssignmentSlotV2, "NONE">;
export type PlanSequenceV2 = 1 | 2 | 3;

export const DRIVER_AVAILABILITIES_V2 = ["AVAILABLE", "UNAVAILABLE"] as const;
export type DriverAvailabilityV2 = (typeof DRIVER_AVAILABILITIES_V2)[number];

export const LOCATION_FRESHNESSES_V2 = ["FRESH", "STALE", "NONE"] as const;
export type LocationFreshnessV2 = (typeof LOCATION_FRESHNESSES_V2)[number];

export const SERVICE_MODULES_V2 = [
  "CHARGING",
  "REFUELING",
  "WASHING",
  "HANDOVER_FORMALITIES",
  "RETURN_FORMALITIES"
] as const;
export type ServiceModuleV2 = (typeof SERVICE_MODULES_V2)[number];

export const DISPATCH_ALERT_STATUSES_V2 = ["OPEN", "RESOLVED"] as const;
export type DispatchAlertStatusV2 = (typeof DISPATCH_ALERT_STATUSES_V2)[number];
export type DispatchAlertTypeV2 = "INFEASIBLE";
export type DispatchAlertResolvedByV2 =
  | "SYSTEM_RECALC"
  | "ORDER_MODIFIED"
  | "ORDER_CANCELLED";

export const ETA_UNAVAILABLE_REASONS_V2 = [
  "AMAP_UNAVAILABLE",
  "ORIGIN_MISSING",
  "DESTINATION_MISSING",
  "LOCATION_STALE"
] as const;
export type EtaUnavailableReasonV2 =
  (typeof ETA_UNAVAILABLE_REASONS_V2)[number];

export type EtaAvailabilityV2 =
  | { etaAvailable: true; etaUnavailableReason?: never }
  | { etaAvailable: false; etaUnavailableReason: EtaUnavailableReasonV2 };

import type {
  AssignmentLockTypeV2,
  BusinessTypeV2,
  DriverAvailabilityV2,
  EtaAvailabilityV2,
  ExecutionStatusV2,
  GeoPointV2,
  IsoDateTimeStringV2,
  LocationFreshnessV2,
  OrderFeasibilityV2,
  PlannedAssignmentSlotV2,
  PlanSequenceV2
} from "./domain";
import type { DriverLocationV2 } from "./driver";

export type DispatchOrderInputV2 = {
  orderId: string;
  orderNo: string;
  businessType: BusinessTypeV2;
  executionStatus: ExecutionStatusV2;
  feasibility: OrderFeasibilityV2;
  slackMinutes: number | null;
  promisedPickupAt: IsoDateTimeStringV2;
  pickupAddress: string;
  pickupLocation?: GeoPointV2;
  deliveryAddress: string;
  deliveryLocation?: GeoPointV2;
  storeCode: string;
  currentAssignmentId?: string;
  serviceModuleMinutes: number;
};

export type DispatchAssignmentInputV2 = {
  assignmentId: string;
  orderId: string;
  sequenceNo: PlanSequenceV2;
  lockType: AssignmentLockTypeV2;
  executionStatus: ExecutionStatusV2;
  pickupLocation?: GeoPointV2;
  deliveryLocation?: GeoPointV2;
  /**
   * 锁定/执行中工单的既有计划出发时间（来自 Assignment.plannedDepartAt）。
   * 调度核心用它判断前置空槽的新工单是否与本锁定槽重叠：
   * 缺失时禁止填充本槽之前的空槽，不得用推算时间补齐。
   */
  plannedDepartAt?: IsoDateTimeStringV2;
  plannedCompleteAt?: IsoDateTimeStringV2;
  serviceModuleMinutes: number;
};

export type DispatchDriverInputV2 = {
  driverId: string;
  storeCode: string;
  onShift: boolean;
  availability: DriverAvailabilityV2;
  planVersion: number;
  locationFreshness: LocationFreshnessV2;
  lastLocation?: DriverLocationV2;
  assignments: DispatchAssignmentInputV2[];
};

export const DISPATCH_TRIGGER_TYPES_V2 = [
  "ORDER_RECEIVED",
  "ORDER_MODIFIED",
  "ORDER_CANCELLED",
  "DRIVER_SHIFT_CHANGED",
  "DRIVER_AVAILABILITY_CHANGED",
  "DRIVER_LOCATION_CHANGED",
  "SERVICE_MODULES_CHANGED",
  "ASSIGNMENT_EXECUTION_CHANGED",
  "BASELINE_RECALCULATION"
] as const;
export type DispatchTriggerTypeV2 = (typeof DISPATCH_TRIGGER_TYPES_V2)[number];

export type DispatchEventV2 = {
  type: DispatchTriggerTypeV2;
  occurredAt: IsoDateTimeStringV2;
  orderId?: string;
  driverId?: string;
  assignmentId?: string;
};

export type DispatchInputV2 = {
  event: DispatchEventV2;
  orders: DispatchOrderInputV2[];
  drivers: DispatchDriverInputV2[];
};

export type DispatchPlannedAssignmentV2 = EtaAvailabilityV2 & {
  assignmentId: string;
  orderId: string;
  sequenceNo: PlanSequenceV2;
  slot: PlannedAssignmentSlotV2;
  plannedDepartAt?: IsoDateTimeStringV2;
  plannedPickupAt?: IsoDateTimeStringV2;
  plannedCompleteAt?: IsoDateTimeStringV2;
  deadheadEtaMinutes?: number;
  serviceEtaMinutes?: number;
};

export type DispatchDriverPlanProposalV2 = {
  driverId: string;
  expectedPlanVersion: number;
  assignments: DispatchPlannedAssignmentV2[];
};

export type DispatchOutputV2 = {
  proposals: DispatchDriverPlanProposalV2[];
  infeasibleOrderIds: string[];
  etaUnavailableOrderIds: string[];
  calculatedAt: IsoDateTimeStringV2;
};

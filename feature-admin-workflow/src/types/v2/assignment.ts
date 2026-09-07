import type {
  AssignmentLockTypeV2,
  AssignmentSlotV2,
  BusinessTypeV2,
  EtaAvailabilityV2,
  ExecutionStatusV2,
  GeoPointV2,
  IsoDateTimeStringV2,
  OrderFeasibilityV2,
  PlannedAssignmentSlotV2,
  PlanSequenceV2,
  ServiceModuleV2
} from "./domain";

type AssignmentFieldsV2 = {
  id: string;
  orderId: string;
  driverId: string;
  sequenceNo?: PlanSequenceV2;
  slot: AssignmentSlotV2;
  lockType: AssignmentLockTypeV2;
  plannedDepartAt?: IsoDateTimeStringV2;
  plannedPickupAt?: IsoDateTimeStringV2;
  plannedCompleteAt?: IsoDateTimeStringV2;
  deadheadEtaMinutes?: number;
  serviceEtaMinutes?: number;
  departedAt?: IsoDateTimeStringV2;
  arrivedAt?: IsoDateTimeStringV2;
  completedAt?: IsoDateTimeStringV2;
  lastEtaCalculatedAt?: IsoDateTimeStringV2;
};

export type AssignmentV2 = AssignmentFieldsV2 & EtaAvailabilityV2;

export type AssignmentSummaryV2 = {
  id: string;
  orderId: string;
  orderNo: string;
  executionStatus: ExecutionStatusV2;
  slot: PlannedAssignmentSlotV2;
  lockType: AssignmentLockTypeV2;
  plannedPickupAt?: IsoDateTimeStringV2;
  plannedCompleteAt?: IsoDateTimeStringV2;
};

export type ServicePlanV2 = {
  assignmentId: string;
  modules: ServiceModuleV2[];
  totalModuleMinutes: number;
  revision: number;
  updatedAt: IsoDateTimeStringV2;
  updatedBy: string;
};

export type DriverTaskV2 = Omit<AssignmentSummaryV2, "executionStatus"> & {
  businessType: BusinessTypeV2;
  executionStatus: Extract<
    ExecutionStatusV2,
    "PLANNED" | "EN_ROUTE" | "IN_SERVICE"
  >;
  feasibility: OrderFeasibilityV2;
  promisedPickupAt: IsoDateTimeStringV2;
  pickupPoint?: GeoPointV2;
  deliveryPoint?: GeoPointV2;
  pickupAddress?: string;
  deliveryAddress?: string;
  servicePlan: ServicePlanV2 | null;
};

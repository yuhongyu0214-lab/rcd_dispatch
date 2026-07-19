import type {
  AssignmentLockType,
  DriverAvailability,
  OrderExecutionStatus,
  OrderFeasibility,
  OrderType,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Repository return types — flat POJOs disconnected from Prisma model instances
// ---------------------------------------------------------------------------

export type DispatchableOrderRow = {
  id: string;
  orderNo: string;
  type: OrderType;
  executionStatus: OrderExecutionStatus;
  feasibility: OrderFeasibility;
  slackMinutes: number | null;
  promisedPickupAt: Date;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveryAddress: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  storeCode: string;
  currentAssignmentId: string | null;
};

export type DispatchableDriverRow = {
  id: string;
  storeCode: string;
  onShift: boolean;
  availability: DriverAvailability;
  planVersion: number;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracyMeters: number | null;
  lastLocationCapturedAt: Date | null;
};

export type EffectiveAssignmentRow = {
  id: string;
  orderId: string;
  driverId: string;
  type: string;
  status: string;
  sequenceNo: number | null;
  lockType: AssignmentLockType;
  plannedDepartAt: Date | null;
  plannedCompleteAt: Date | null;
  // Fields from the related Order
  orderExecutionStatus: OrderExecutionStatus;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
};

export type ServicePlanRow = {
  assignmentId: string;
  totalModuleMinutes: number;
};

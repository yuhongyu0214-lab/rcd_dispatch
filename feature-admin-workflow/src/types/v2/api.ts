import type {
  DriverAvailabilityV2,
  ExecutionStatusV2,
  IsoDateTimeStringV2,
  ServiceModuleV2
} from "./domain";
import type { LocationInvalidReasonV2 } from "./driver";

export const API_ERROR_CODES_V2 = [
  "VALIDATION_FAILED",
  "ILLEGAL_TRANSITION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "PLAN_VERSION_CONFLICT",
  "DUPLICATE_OPERATION",
  "PAYLOAD_TOO_LARGE",
  "LOCATION_INVALID",
  "INTERNAL_ERROR",
  "DEPENDENCY_UNAVAILABLE"
] as const;
export type ApiErrorCodeV2 = (typeof API_ERROR_CODES_V2)[number];

export type ValidationFailedDetailsV2 = {
  fields: Record<string, string[]>;
};

export type IllegalTransitionDetailsV2 = {
  currentStatus: ExecutionStatusV2;
  targetStatus: ExecutionStatusV2;
};

export type PlanVersionConflictDetailsV2 =
  | { currentPlanVersion: number }
  | { currentFromPlanVersion: number; currentToPlanVersion: number };

export type PayloadTooLargeDetailsV2 =
  | { limit: number; observedBytes: number }
  | { limit: number; actualRecords: number };

export type ExternalDependencyV2 = "AMAP" | "REDIS" | "ORDER_SOURCE";

export type ApiErrorDetailsByCodeV2 = {
  VALIDATION_FAILED: ValidationFailedDetailsV2;
  ILLEGAL_TRANSITION: IllegalTransitionDetailsV2;
  UNAUTHORIZED: undefined;
  FORBIDDEN: undefined;
  NOT_FOUND: undefined;
  PLAN_VERSION_CONFLICT: PlanVersionConflictDetailsV2;
  DUPLICATE_OPERATION: undefined;
  PAYLOAD_TOO_LARGE: PayloadTooLargeDetailsV2;
  LOCATION_INVALID: { reason: LocationInvalidReasonV2 };
  INTERNAL_ERROR: undefined;
  DEPENDENCY_UNAVAILABLE: { dependency: ExternalDependencyV2 };
};

export type ApiErrorV2<C extends ApiErrorCodeV2 = ApiErrorCodeV2> = {
  [K in C]: {
    code: K;
    message: string;
  } & (ApiErrorDetailsByCodeV2[K] extends undefined
    ? { details?: never }
    : { details: ApiErrorDetailsByCodeV2[K] });
}[C];

export type ApiSuccessV2<T> = {
  success: true;
  data: T;
  error: null;
  traceId: string;
};

export type ApiFailureV2<E extends ApiErrorV2 = ApiErrorV2> = {
  success: false;
  data: null;
  error: E;
  traceId: string;
};

export type ApiResponseV2<T, E extends ApiErrorV2 = ApiErrorV2> =
  | ApiSuccessV2<T>
  | ApiFailureV2<E>;

export type PageResultV2<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type UpdateOrderCommandV2 = {
  promisedPickupAt?: IsoDateTimeStringV2;
  pickupAddress?: string;
  deliveryAddress?: string;
  reason: string;
};

export type CancelOrderCommandV2 = { reason: string };

export type SetDriverAvailabilityCommandV2 = {
  availability: DriverAvailabilityV2;
  reason: string;
};

export type AssignCommandV2 = {
  orderId: string;
  driverId: string;
  reason: string;
  expectedPlanVersion: number;
};

export type ReassignCommandV2 = {
  toDriverId: string;
  reason: string;
  expectedFromPlanVersion: number;
  expectedToPlanVersion: number;
};

export type PlanEditCommandV2 = {
  reason: string;
  expectedPlanVersion: number;
};

export type UpdateServiceModulesCommandV2 = {
  modules: ServiceModuleV2[];
};

export type ReplayedResultV2 = { replayed: boolean };

export type IngestResultReasonV2 =
  | "STALE_VERSION"
  | "DUPLICATE"
  | "FOLLOW_UP_REQUIRED"
  | "VALIDATION_FAILED";

export type IngestRecordResultV2 = {
  index: number;
  externalOrderId: string;
  sourceVersion: string;
  status: "success" | "skipped" | "failed";
  reason?: IngestResultReasonV2;
  replayed?: boolean;
  traceId: string;
};

export type IngestBatchResultV2 = {
  results: IngestRecordResultV2[];
  success: number;
  skipped: number;
  failed: number;
};

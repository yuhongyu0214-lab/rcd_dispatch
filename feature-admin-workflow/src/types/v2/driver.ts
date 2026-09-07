import type { AssignmentSummaryV2 } from "./assignment";
import type {
  DriverAvailabilityV2,
  GeoPointV2,
  IsoDateTimeStringV2,
  LocationFreshnessV2,
  PlannedAssignmentSlotV2
} from "./domain";

export type DriverLocationV2 = GeoPointV2 & {
  accuracyMeters: number;
  capturedAt: IsoDateTimeStringV2;
};

export type DriverSlotsV2 = Partial<
  Record<PlannedAssignmentSlotV2, AssignmentSummaryV2>
>;

export type DriverV2 = {
  id: string;
  name: string;
  storeCode: string;
  onShift: boolean;
  shiftStartedAt?: IsoDateTimeStringV2;
  availability: DriverAvailabilityV2;
  planVersion: number;
  locationFreshness: LocationFreshnessV2;
  lastLocation?: DriverLocationV2;
  slots: DriverSlotsV2;
};

export type DriverPlanV2 = Pick<
  DriverV2,
  "id" | "name" | "planVersion" | "locationFreshness" | "lastLocation" | "slots"
>;

export type LocationSampleV2 = DriverLocationV2;

export type LocationRejectionReasonV2 =
  | "ACCURACY_TOO_LOW"
  | "CLOCK_SKEW"
  | "EXPIRED_AT_RECEIPT"
  /** 结构非法样本：非有限数/越界坐标、负精度或无法解析的采集时间 */
  | "INVALID_SAMPLE"
  | "DUPLICATE";

export type LocationInvalidReasonV2 = Exclude<
  LocationRejectionReasonV2,
  "DUPLICATE"
>;

export type LocationSampleResultV2 =
  | { index: number; status: "success" }
  | { index: number; status: "skipped"; reason: LocationRejectionReasonV2 };

export type LocationBatchV2 = {
  samples: LocationSampleV2[];
};

export type LocationBatchResultV2 = {
  results: LocationSampleResultV2[];
  success: number;
  skipped: number;
};

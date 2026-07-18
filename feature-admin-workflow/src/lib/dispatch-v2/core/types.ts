import type { GeoPointV2, IsoDateTimeStringV2 } from "@/types/v2";

/**
 * Pure ETA resolver — deterministic function computing travel minutes between two points.
 * Returns null only when ETA cannot be determined (missing coordinates).
 *
 * The default resolver uses haversine distance with a fixed average speed.
 * In Gate 3 (dispatch-integration), this will be swapped for an Amap-backed resolver
 * that uses pre-computed ETA matrices.
 */
export type EtaResolver = (from: GeoPointV2, to: GeoPointV2) => number | null;

/**
 * Timeline cursor tracking a driver's state during slot planning.
 *
 * position: where the driver will be at `availableAt`.
 * availableAt: the earliest moment the driver can accept a new deadhead trip.
 *
 * When position is null (no lastLocation or no delivery location from
 * the most recent completed assignment), the cursor cannot provide ETA
 * estimates for subsequent slots.
 */
export type DriverCursor = {
  position: GeoPointV2 | null;
  availableAt: IsoDateTimeStringV2;
  etaAvailable: boolean;
};

/**
 * Key for slot-planner: identifies a driver and their next available slot.
 */
export type DriverSlotKey = {
  driverId: string;
  /** The sequenceNo this assignment would fill (1..3). */
  sequenceNo: PlanSequenceV2;
  /** Pre-resolved slot label (A/B/C). */
  slot: PlannedAssignmentSlotV2;
};

/**
 * Shorthand aliases from the shared domain.
 */
import type {
  PlanSequenceV2,
  PlannedAssignmentSlotV2,
} from "@/types/v2";

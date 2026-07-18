import type { GeoPointV2, IsoDateTimeStringV2 } from "@/types/v2";

/**
 * Pure ETA resolver — deterministic function computing travel minutes between two points.
 * Returns null when ETA cannot be determined (missing coordinates, provider gap).
 *
 * The dispatch core NEVER generates ETA values itself (no haversine/average-speed
 * estimates — fake ETA is a frozen-spec P0 blocker). A real resolver must be
 * injected by the integration layer; in Gate 3 (dispatch-integration) this is an
 * Amap-backed resolver using pre-computed ETA matrices. When no resolver is
 * injected, the core treats every ETA as unavailable.
 */
export type EtaResolver = (from: GeoPointV2, to: GeoPointV2) => number | null;

/**
 * Timeline cursor tracking a driver's state during slot planning.
 *
 * position: where the driver will be at `availableAt`. `null` means the
 * position is unknown (no lastLocation, or an immobile assignment without a
 * stored deliveryLocation) — the cursor cannot provide ETA estimates for
 * subsequent slots.
 *
 * availableAt: the earliest moment the driver can accept a new deadhead
 * trip. `null` means the moment is UNKNOWN — this happens when the cursor
 * was advanced past an immobile (locked / executing) assignment that has no
 * stored plannedCompleteAt. The core must NEVER reconstruct the missing time
 * (no ETA recomputation, no fallback): subsequent slots simply cannot be
 * planned, and orders needing them classify as ETA-unavailable.
 */
export type DriverCursor = {
  position: GeoPointV2 | null;
  availableAt: IsoDateTimeStringV2 | null;
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

import type {
  DispatchDriverPlanProposalV2,
  DispatchInputV2,
  DispatchOutputV2,
  GeoPointV2,
} from "@/types/v2";

import { filterCandidateDrivers } from "./candidate-filter";
import { sortOrdersByPriority } from "./sorter";
import { planSlots } from "./slot-planner";
import type { EtaResolver } from "./types";

// ---------------------------------------------------------------------------
// Default ETA resolver — Haversine-based (pure, deterministic)
// ---------------------------------------------------------------------------

/** Earth's radius in km. */
const EARTH_RADIUS_KM = 6371;

/** Average urban speed in km/h for fallback ETA estimation. */
const AVERAGE_SPEED_KMH = 30;

/**
 * Deterministic Haversine ETA resolver.
 *
 * Computes great-circle distance between two points and estimates travel
 * time using a fixed average urban speed. No external services, no I/O.
 *
 * Returns null only when coordinates are invalid (NaN, Infinity).
 */
export function haversineEtaResolver(from: GeoPointV2, to: GeoPointV2): number | null {
  const { lat: lat1, lng: lng1 } = from;
  const { lat: lat2, lng: lng2 } = to;

  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return null;
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;
  const minutes = distanceKm / (AVERAGE_SPEED_KMH / 60);

  return Math.round(minutes);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the V2 dispatch pure-computation core.
 *
 * Pipeline:
 *   1. Filter candidate drivers (onShift + AVAILABLE + FRESH)
 *   2. Sort orders by promisedPickupAt (earliest first)
 *   3. Plan slots: identify immobile assignments, greedily assign orders
 *
 * Deterministic: same input always produces the same output.
 * Pure: no Prisma, no Redis, no HTTP, no Date.now(), no Math.random().
 *
 * @param input - Dispatch input DTO (orders + drivers + event)
 * @param etaResolver - Optional ETA resolver (defaults to haversine-based)
 * @returns Dispatch output with proposals, infeasible IDs, and unavailable IDs
 */
export function runDispatchV2(
  input: DispatchInputV2,
  etaResolver?: EtaResolver
): DispatchOutputV2 {
  const resolveEta = etaResolver ?? haversineEtaResolver;

  // 1. Filter candidate drivers
  const candidates = filterCandidateDrivers(input.drivers);

  // 2. Sort orders by priority
  const sortedOrders = sortOrdersByPriority(input.orders);

  // 3. Plan slots
  const result = planSlots(
    input.drivers,
    candidates,
    sortedOrders,
    input.event.occurredAt,
    resolveEta
  );

  // 4. Build output
  const proposals: DispatchDriverPlanProposalV2[] = input.drivers.map((d) => ({
    driverId: d.driverId,
    expectedPlanVersion: d.planVersion,
    assignments: result.proposals.get(d.driverId) ?? [],
  }));

  return {
    proposals,
    infeasibleOrderIds: result.infeasibleOrderIds,
    etaUnavailableOrderIds: result.etaUnavailableOrderIds,
    calculatedAt: input.event.occurredAt,
  };
}

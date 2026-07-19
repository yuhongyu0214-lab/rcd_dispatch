import type {
  DispatchDriverPlanProposalV2,
  DispatchInputV2,
  DispatchOutputV2,
} from "@/types/v2";

import { filterCandidateDrivers, filterDispatchableOrders } from "./candidate-filter";
import { sortOrdersByPriority } from "./sorter";
import { planSlots } from "./slot-planner";
import type { EtaResolver } from "./types";

export { filterCandidateDrivers, filterDispatchableOrders };

// ---------------------------------------------------------------------------
// No-ETA mode resolver
// ---------------------------------------------------------------------------

/**
 * Resolver used when the caller does NOT inject a real ETA source.
 *
 * The dispatch core must NEVER fabricate ETA values (e.g. haversine distance
 * at an assumed average speed) — fake ETA is a frozen-spec P0 blocker. When
 * no resolver is injected the core runs in "no ETA" mode:
 *
 *   - locked / frozen / executing assignments are still respected (and keep
 *     their stored planned times),
 *   - but no new deadhead ETA can be computed, so orders that would need a
 *     fresh plan are reported via `evaluations` with result "ETA_UNAVAILABLE"
 *     instead of being planned with invented times.
 */
const noEtaResolver: EtaResolver = () => null;

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
 * @param etaResolver - Real ETA resolver injected by the integration layer
 *   (Gate 3: Amap-backed matrix). The core itself never generates ETA values.
 *   When absent, the core runs in "no ETA" mode: immobile assignments are
 *   preserved, but orders needing a new deadhead ETA end up in
 *   `evaluations` with result "ETA_UNAVAILABLE" (never planned with fake ETAs).
 * @returns Dispatch output with proposals and per-order evaluations.
 *   No sentinel slack values (-999/9999); ETA_UNAVAILABLE / UNPLANNED carry
 *   bestSlackMinutes: null.
 */
export function runDispatchV2(
  input: DispatchInputV2,
  etaResolver?: EtaResolver
): DispatchOutputV2 {
  // P0: no silent haversine fallback — absent resolver means "ETA unavailable".
  const resolveEta = etaResolver ?? noEtaResolver;

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
    evaluations: result.evaluations,
    calculatedAt: input.event.occurredAt,
  };
}

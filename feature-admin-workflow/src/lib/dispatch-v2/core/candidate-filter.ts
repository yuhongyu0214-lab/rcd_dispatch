import type { DispatchDriverInputV2, DispatchOrderInputV2 } from "@/types/v2";

/**
 * Filter drivers to only those eligible for dispatch planning.
 *
 * A driver must satisfy ALL three conditions:
 *   - onShift = true
 *   - availability = AVAILABLE
 *   - locationFreshness = FRESH
 *
 * Pure function — no side effects, deterministic output for the same input.
 *
 * @param drivers - All drivers from the dispatch input
 * @returns Only candidate drivers that meet all three criteria
 */
export function filterCandidateDrivers(
  drivers: readonly DispatchDriverInputV2[]
): DispatchDriverInputV2[] {
  return drivers.filter(
    (d) =>
      d.onShift === true &&
      d.availability === "AVAILABLE" &&
      d.locationFreshness === "FRESH"
  );
}

/**
 * Filter orders to only those that may enter the dispatchable pool as NEW work.
 *
 * Only executionStatus = UNASSIGNED qualifies:
 *   - PLANNED / EN_ROUTE / IN_SERVICE orders are already carried by existing
 *     assignments (the slot planner decides whether those stay in place or are
 *     released for replanning),
 *   - COMPLETED / CANCELLED are terminal states and must NEVER be
 *     (re-)dispatched, even when no assignment references them.
 *
 * Pure function — no side effects, deterministic output for the same input.
 *
 * @param orders - Orders from the dispatch input
 * @returns Only orders that are dispatchable as new work
 */
export function filterDispatchableOrders(
  orders: readonly DispatchOrderInputV2[]
): DispatchOrderInputV2[] {
  return orders.filter((o) => o.executionStatus === "UNASSIGNED");
}

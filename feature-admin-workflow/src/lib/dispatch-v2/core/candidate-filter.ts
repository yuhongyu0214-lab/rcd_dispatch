import type { DispatchDriverInputV2 } from "@/types/v2";

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

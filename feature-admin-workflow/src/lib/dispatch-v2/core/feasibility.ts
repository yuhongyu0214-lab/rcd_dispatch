import type {
  EtaUnavailableReasonV2,
  IsoDateTimeStringV2,
  OrderFeasibilityV2,
} from "@/types/v2";

/**
 * Compute the slack (safety margin) in minutes between promised pickup
 * and projected pickup time.
 *
 * slackMinutes = promisedPickupAt - projectedPickupAt
 *
 * Positive values mean the driver would arrive BEFORE the promised time
 * (good). Negative values mean the driver would arrive AFTER the promised
 * time (risk of being late).
 *
 * Pure function — deterministic for the same ISO date-string inputs.
 *
 * @param promisedPickupAt - The customer-facing pickup promise time
 * @param projectedPickupAt - The projected pickup time based on ETA
 * @returns Slack in minutes (can be negative, zero, or positive)
 */
export function calculateSlackMinutes(
  promisedPickupAt: IsoDateTimeStringV2,
  projectedPickupAt: IsoDateTimeStringV2
): number {
  const promised = new Date(promisedPickupAt).getTime();
  const projected = new Date(projectedPickupAt).getTime();
  return (promised - projected) / 60000;
}

/**
 * Determine the feasibility classification for an order based on
 * slack minutes and ETA availability.
 *
 * Per PRD V2 section 5.1:
 *   NORMAL:    slackMinutes >= 10
 *   AT_RISK:   -30 <= slackMinutes < 10
 *   INFEASIBLE: slackMinutes < -30
 *   UNKNOWN:   ETA is unavailable
 *
 * Pure function — deterministic for the same inputs.
 *
 * @param promisedPickupAt - The customer-facing pickup promise time
 * @param projectedPickupAt - The projected pickup time (can be null if ETA unavailable)
 * @param etaAvailable - Whether ETA data was available for this computation
 * @returns The feasibility classification
 */
export function calculateFeasibility(
  promisedPickupAt: IsoDateTimeStringV2,
  projectedPickupAt: IsoDateTimeStringV2,
  etaAvailable: boolean
): OrderFeasibilityV2 {
  if (!etaAvailable) {
    return "UNKNOWN";
  }

  const slack = calculateSlackMinutes(promisedPickupAt, projectedPickupAt);

  if (slack < -30) {
    return "INFEASIBLE";
  }

  if (slack < 10) {
    return "AT_RISK";
  }

  return "NORMAL";
}

/**
 * Determine the most specific ETA-unavailable reason given what is missing.
 *
 * @param hasOrigin - Whether the driver's position is known
 * @param hasDestination - Whether the order pickup location is known
 * @returns The appropriate ETA-unavailable reason
 */
export function etaUnavailableReason(
  hasOrigin: boolean,
  hasDestination: boolean
): EtaUnavailableReasonV2 {
  if (!hasOrigin) {
    return "ORIGIN_MISSING";
  }
  if (!hasDestination) {
    return "DESTINATION_MISSING";
  }
  // When both endpoints exist but the injected resolver still returned null
  // (provider gap, calculation failure), fall back to the generic reason.
  return "AMAP_UNAVAILABLE";
}

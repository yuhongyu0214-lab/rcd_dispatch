import type { LocationSampleV2 } from "@/types/v2";

import type { ValidationResult } from "./types";

/** Maximum accuracy in meters — samples exceeding this are rejected (data architecture §7.1 rule 1) */
const MAX_ACCURACY_METERS = 100;

/** Maximum client clock skew ahead of server (30 seconds, rule 2) */
const MAX_CLOCK_SKEW_MS = 30_000;

/** Maximum sample age at receipt (120 seconds, rule 3) */
const MAX_SAMPLE_AGE_MS = 120_000;

/**
 * Validate a single location sample against the three frozen rejection rules
 * (data architecture §7.1 rules 1-3).
 *
 * Returns { valid: true } or { valid: false, reason: LocationInvalidReasonV2 }.
 */
export function validateLocationSample(
  sample: LocationSampleV2,
  serverTimeMs: number
): ValidationResult {
  // Rule 1: Accuracy must not exceed 100 meters
  if (sample.accuracyMeters > MAX_ACCURACY_METERS) {
    return { valid: false, reason: "ACCURACY_TOO_LOW" };
  }

  const capturedAtMs = new Date(sample.capturedAt).getTime();

  // Rule 2: Client clock must not be ahead of server by more than 30 seconds
  if (capturedAtMs - serverTimeMs > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: "CLOCK_SKEW" };
  }

  // Rule 3: Sample must not be older than 120 seconds at receipt
  if (serverTimeMs - capturedAtMs > MAX_SAMPLE_AGE_MS) {
    return { valid: false, reason: "EXPIRED_AT_RECEIPT" };
  }

  return { valid: true };
}

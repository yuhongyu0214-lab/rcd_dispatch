import type { LocationSampleV2 } from "@/types/v2";

import type { ValidationResult } from "./types";

/** Maximum accuracy in meters — samples exceeding this are rejected (data architecture §7.1 rule 1) */
const MAX_ACCURACY_METERS = 100;

/** Maximum client clock skew ahead of server (30 seconds, rule 2) */
const MAX_CLOCK_SKEW_MS = 30_000;

/** Maximum sample age at receipt (120 seconds, rule 3) */
const MAX_SAMPLE_AGE_MS = 120_000;

/** GCJ-02 China mainland coordinate bounds — samples outside are rejected */
const GCJ02_LAT_MIN = 18;
const GCJ02_LAT_MAX = 54;
const GCJ02_LNG_MIN = 73;
const GCJ02_LNG_MAX = 136;

/**
 * Validate a single location sample.
 *
 * Structural checks (run before the frozen threshold rules):
 * - `accuracyMeters` must be a finite, non-negative number → ACCURACY_TOO_LOW
 * - `lat`/`lng` must be finite numbers within the GCJ-02 China bounds → INVALID_SAMPLE
 * - `capturedAt` must be a string that parses to a valid Date → INVALID_SAMPLE
 *
 * Frozen threshold rules (data architecture §7.1 rules 1-3):
 * - accuracy > 100m → ACCURACY_TOO_LOW
 * - client clock more than 30s ahead of server → CLOCK_SKEW
 * - sample older than 120s at receipt → EXPIRED_AT_RECEIPT
 *
 * Returns { valid: true } or { valid: false, reason: LocationInvalidReasonV2 }.
 */
export function validateLocationSample(
  sample: LocationSampleV2,
  serverTimeMs: number
): ValidationResult {
  // Structural check: accuracy must be a finite, non-negative number.
  // NaN / Infinity / negative values would otherwise slip past the `> 100` rule.
  if (!Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters < 0) {
    return { valid: false, reason: "ACCURACY_TOO_LOW" };
  }

  // Structural check: coordinates must be finite and within GCJ-02 China bounds.
  if (
    !Number.isFinite(sample.lat) ||
    !Number.isFinite(sample.lng) ||
    sample.lat < GCJ02_LAT_MIN ||
    sample.lat > GCJ02_LAT_MAX ||
    sample.lng < GCJ02_LNG_MIN ||
    sample.lng > GCJ02_LNG_MAX
  ) {
    return { valid: false, reason: "INVALID_SAMPLE" };
  }

  // Structural check: capturedAt must be an ISO string parsing to a valid date.
  // NaN timestamps would otherwise pass rules 2-3 (NaN comparisons are false).
  if (typeof sample.capturedAt !== "string") {
    return { valid: false, reason: "INVALID_SAMPLE" };
  }
  const capturedAtMs = new Date(sample.capturedAt).getTime();
  if (Number.isNaN(capturedAtMs)) {
    return { valid: false, reason: "INVALID_SAMPLE" };
  }

  // Rule 1: Accuracy must not exceed 100 meters
  if (sample.accuracyMeters > MAX_ACCURACY_METERS) {
    return { valid: false, reason: "ACCURACY_TOO_LOW" };
  }

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

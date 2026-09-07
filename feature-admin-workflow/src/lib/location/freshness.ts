import type { LocationFreshnessV2 } from "@/types/v2";

import type { FreshnessResult } from "./types";

/** Freshness threshold: 120 seconds from capture (data architecture §7.1 rule 5) */
const FRESH_THRESHOLD_MS = 120_000;

/**
 * Calculate location freshness based on the sample's capture time.
 *
 * Rules (data architecture §7.1 rule 5):
 * - No capturedAt → NONE
 * - capturedAt within 120s of server time → FRESH
 * - capturedAt older than 120s → STALE
 */
export function calculateFreshness(
  capturedAt: string | null,
  serverTimeMs: number
): FreshnessResult {
  if (capturedAt === null) {
    return { freshness: "NONE", capturedAt: null };
  }

  const capturedAtMs = new Date(capturedAt).getTime();
  const age = serverTimeMs - capturedAtMs;

  if (age <= FRESH_THRESHOLD_MS) {
    return { freshness: "FRESH", capturedAt };
  }

  return { freshness: "STALE", capturedAt };
}

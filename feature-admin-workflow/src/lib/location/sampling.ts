import type { LocationSampleV2 } from "@/types/v2";
import type { DriverLocationSample } from "@prisma/client";

import type { SamplingDecision } from "./types";

/** Minimum interval between location samples saved to PostgreSQL (120s, rule 7) */
const SAMPLE_INTERVAL_MS = 120_000;

/** Minimum distance moved to trigger a new sample write (200m, rule 7) */
const MIN_DISTANCE_METERS = 200;

/**
 * Haversine distance between two points in meters.
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Determine whether a new location sample should be persisted to PostgreSQL.
 *
 * Decision rules (data architecture §7.1 rule 7):
 * - Business event (depart/arrive/complete/shift start/shift end) → always save
 * - No previous sample → save (first sample)
 * - 120+ seconds elapsed since last sample → save
 * - Moved more than 200 meters from last sample → save
 * - Otherwise → skip
 */
export function shouldSaveSample(
  newSample: LocationSampleV2,
  lastSample: DriverLocationSample | null,
  isBusinessEvent: boolean
): SamplingDecision {
  if (isBusinessEvent) {
    return { shouldSample: true, reason: "business_event" };
  }

  if (lastSample === null) {
    return { shouldSample: true, reason: "first_sample" };
  }

  const newTime = new Date(newSample.capturedAt).getTime();
  const lastTime = new Date(lastSample.capturedAt).getTime();

  if (newTime - lastTime >= SAMPLE_INTERVAL_MS) {
    return { shouldSample: true, reason: "time_elapsed" };
  }

  const distance = haversineDistance(
    newSample.lat,
    newSample.lng,
    lastSample.lat,
    lastSample.lng
  );

  if (distance > MIN_DISTANCE_METERS) {
    return { shouldSample: true, reason: "distance_moved" };
  }

  return { shouldSample: false, reason: "no_significant_change" };
}

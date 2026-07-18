import type { LocationSampleV2, LocationBatchResultV2, LocationSampleResultV2, LocationFreshnessV2 } from "@/types/v2";

import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  getDriverLocation,
  isRedisAvailable,
  setDriverLocation,
  setDriverOnline
} from "@/lib/redis";

import { calculateFreshness } from "./freshness";
import { shouldSaveSample } from "./sampling";
import { validateLocationSample } from "./validate";

const log = createLogger("location");

/**
 * Process a batch of location samples for a single driver.
 *
 * For each sample: validate → dedup check → Redis write → conditional DB save.
 * Per-sample validation: one rejection does NOT block other samples in the batch
 * (API contract §13).
 */
export async function processLocationBatch(
  driverId: string,
  samples: LocationSampleV2[],
  traceId: string
): Promise<LocationBatchResultV2> {
  const results: LocationSampleResultV2[] = [];
  const serverTimeMs = Date.now();
  const redisAvailable = isRedisAvailable();

  // Fetch the most recent DB sample for sampling decisions (rule 7)
  let lastSample = null;
  try {
    lastSample = await prisma.driverLocationSample.findFirst({
      where: { driverId },
      orderBy: { capturedAt: "desc" }
    });
  } catch {
    // Non-fatal — sampling decisions degrade to "always save"
  }

  // Bulk pre-check for duplicate (driverId, capturedAt) to avoid per-sample round trips
  const capturedAts = samples.map((s) => new Date(s.capturedAt));
  const existingCaptureTimes = new Set<number>();

  try {
    const existingRows = await prisma.driverLocationSample.findMany({
      where: {
        driverId,
        capturedAt: { in: capturedAts }
      },
      select: { capturedAt: true }
    });

    for (const row of existingRows) {
      existingCaptureTimes.add(row.capturedAt.getTime());
    }
  } catch {
    // Non-fatal — dedup degrades gracefully
  }

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // ---- Validate ----
    const validation = validateLocationSample(sample, serverTimeMs);
    if (!validation.valid) {
      results.push({ index: i, status: "skipped", reason: validation.reason });
      log.info("Location sample rejected", {
        traceId,
        driverId,
        index: i,
        reason: validation.reason
      });
      continue;
    }

    // ---- Dedup check (rule 4) ----
    const capturedAtMs = new Date(sample.capturedAt).getTime();
    if (existingCaptureTimes.has(capturedAtMs)) {
      results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
      continue;
    }
    existingCaptureTimes.add(capturedAtMs);

    // ---- Redis write (rule 6) ----
    if (redisAvailable) {
      try {
        await setDriverLocation(driverId, {
          lat: String(sample.lat),
          lng: String(sample.lng),
          accuracy: String(sample.accuracyMeters),
          ts: sample.capturedAt,
          server_ts: String(serverTimeMs),
          status: "ACTIVE"
        });
        await setDriverOnline(driverId);
      } catch {
        log.warn("Redis write failed for location batch", {
          traceId,
          driverId,
          index: i
        });
      }
    }

    // ---- Conditional PostgreSQL sample (rule 7) ----
    const decision = shouldSaveSample(sample, lastSample, false);
    if (decision.shouldSample) {
      try {
        const created = await prisma.driverLocationSample.create({
          data: {
            driverId,
            lat: sample.lat,
            lng: sample.lng,
            accuracyMeters: sample.accuracyMeters,
            capturedAt: new Date(sample.capturedAt)
          }
        });
        lastSample = {
          id: created.id,
          driverId: created.driverId,
          lat: created.lat,
          lng: created.lng,
          accuracyMeters: created.accuracyMeters,
          capturedAt: created.capturedAt,
          receivedAt: created.receivedAt,
          createdAt: created.createdAt
        };
      } catch {
        log.warn("Failed to persist location sample", {
          traceId,
          driverId,
          index: i
        });
      }
    }

    // ---- Update Driver.lastLat / lastLng (best-effort) ----
    try {
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          lastLat: sample.lat,
          lastLng: sample.lng,
          lastAccuracyMeters: sample.accuracyMeters,
          lastLocationCapturedAt: new Date(sample.capturedAt)
        }
      });
    } catch {
      // Non-fatal
    }

    results.push({ index: i, status: "success" });
  }

  const success = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  log.info("Location batch processed", {
    traceId,
    driverId,
    total: samples.length,
    success,
    skipped
  });

  return { results, success, skipped };
}

/**
 * Determine location freshness for a driver (rule 5).
 *
 * Tries Redis first; on failure or missing data, falls back to the database
 * `Driver.lastLocationCapturedAt` column (rule 11).
 */
export async function getDriverLocationFreshness(
  driverId: string
): Promise<LocationFreshnessV2> {
  const serverTimeMs = Date.now();

  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const redisLocation = await getDriverLocation(driverId);
      if (redisLocation?.ts) {
        return calculateFreshness(redisLocation.ts, serverTimeMs).freshness;
      }
    } catch {
      // Fall through to DB fallback
    }
  }

  // DB fallback (rule 11)
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { lastLocationCapturedAt: true }
    });

    if (driver?.lastLocationCapturedAt) {
      return calculateFreshness(
        driver.lastLocationCapturedAt.toISOString(),
        serverTimeMs
      ).freshness;
    }
  } catch {
    log.error("DB fallback for freshness failed", { driverId });
  }

  return "NONE";
}

/**
 * Check whether a driver is eligible for dispatch consideration (rule 12).
 *
 * Candidate criteria:
 * - onShift === true
 * - availability === 'AVAILABLE'
 * - locationFreshness === 'FRESH'
 */
export async function isCandidateDriver(
  driverId: string
): Promise<boolean> {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { onShift: true, availability: true }
    });

    if (!driver || !driver.onShift || driver.availability !== "AVAILABLE") {
      return false;
    }

    const freshness = await getDriverLocationFreshness(driverId);
    return freshness === "FRESH";
  } catch {
    log.error("isCandidateDriver failed", { driverId });
    return false;
  }
}

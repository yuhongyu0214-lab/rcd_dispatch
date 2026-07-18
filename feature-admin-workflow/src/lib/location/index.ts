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
  let dbSampleWriteFailures = 0;
  let driverUpdateFailures = 0;

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

  // P0-1: read the current Redis location once so out-of-order samples
  // (in-batch or across batches) can never regress the cached position.
  // We track the newest known capturedAt and only overwrite with newer data.
  let newestRedisCapturedAtMs: number | null = null;
  if (redisAvailable) {
    try {
      const currentRedisLocation = await getDriverLocation(driverId);
      if (currentRedisLocation?.ts) {
        const currentMs = new Date(currentRedisLocation.ts).getTime();
        if (Number.isFinite(currentMs)) {
          newestRedisCapturedAtMs = currentMs;
        }
      }
    } catch {
      // Treat as no existing cached location
    }
  }

  // Bulk pre-check for duplicate (driverId, capturedAt) to avoid per-sample round trips.
  // Unparseable capturedAt values are excluded — they are rejected per-sample by validation.
  const capturedAts = samples
    .map((s) => new Date(s.capturedAt))
    .filter((d) => Number.isFinite(d.getTime()));
  const existingCaptureTimes = new Set<number>();

  try {
    if (capturedAts.length > 0) {
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
    // P0-1: only overwrite the cached location when this sample is strictly
    // newer than the newest known capturedAt. Older samples are still
    // processed for sampling/DB below — they just must not regress the cache.
    if (
      redisAvailable &&
      (newestRedisCapturedAtMs === null || capturedAtMs > newestRedisCapturedAtMs)
    ) {
      try {
        // NOTE (P1-3): lib/redis.ts applies TTL=300s to driver:last_location
        // and driver:online keys, but the frozen spec requires TTL=180s.
        // redis.ts is shared infrastructure outside this stage's allowed scope
        // and does not expose the raw client for a separate TTL adjustment.
        // TODO(Gate 3): reconcile the TTL in lib/redis.ts to the frozen 180s.
        await setDriverLocation(driverId, {
          lat: String(sample.lat),
          lng: String(sample.lng),
          accuracy: String(sample.accuracyMeters),
          ts: sample.capturedAt,
          server_ts: String(serverTimeMs),
          status: "ACTIVE"
        });
        await setDriverOnline(driverId);
        newestRedisCapturedAtMs = capturedAtMs;
      } catch {
        // P1-2: Redis is a cache, not the source of truth — a failed cache
        // write must not fail the sample. Log clearly and continue.
        log.warn("Redis write failed for location batch (cache only, sample still accepted)", {
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
        // P1-2: the sample was received and validated — a failed history write
        // does not fail the sample, but it is counted and surfaced in the log.
        dbSampleWriteFailures += 1;
        log.warn("Failed to persist location sample", {
          traceId,
          driverId,
          index: i
        });
      }
    }

    // ---- Update Driver.lastLat / lastLng (best-effort, monotonic) ----
    // P0-1: conditional update — only overwrite when this sample is newer than
    // the stored capture time (or none is stored), so out-of-order samples
    // cannot regress Driver.lastLat/lastLng. updateMany makes this atomic.
    try {
      await prisma.driver.updateMany({
        where: {
          id: driverId,
          OR: [
            { lastLocationCapturedAt: null },
            { lastLocationCapturedAt: { lt: new Date(capturedAtMs) } }
          ]
        },
        data: {
          lastLat: sample.lat,
          lastLng: sample.lng,
          lastAccuracyMeters: sample.accuracyMeters,
          lastLocationCapturedAt: new Date(capturedAtMs)
        }
      });
    } catch {
      // P1-2: best-effort — do not fail the sample, but surface the problem.
      driverUpdateFailures += 1;
      log.warn("Failed to update Driver.lastLocation fields", {
        traceId,
        driverId,
        index: i
      });
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
    skipped,
    dbSampleWriteFailures,
    driverUpdateFailures
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

import type { LocationSampleV2, LocationBatchResultV2, LocationSampleResultV2, LocationFreshnessV2 } from "@/types/v2";

import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  getDriverLocation,
  isRedisAvailable,
  setDriverLocationIfNewer,
  setDriverOnline
} from "@/lib/redis";

import { calculateFreshness } from "./freshness";
import { shouldSaveSample } from "./sampling";
import { validateLocationSample } from "./validate";

const log = createLogger("location");

/** Thrown when a DB claim (updateMany) fails — route translates to batch 500. */
export class DbClaimFailedError extends Error {
  constructor(
    message: string,
    readonly partialResults: LocationSampleResultV2[]
  ) {
    super(message);
    this.name = "DbClaimFailedError";
  }
}

/**
 * Process a batch of location samples for a single driver.
 *
 * Unified per-sample pipeline:
 *   1) validate
 *   2) DB high-water claim (driver.updateMany conditional on
 *      lastLocationCapturedAt < capturedAt) — DB is the idempotency authority
 *   3) on claim success → Redis CAS (cache monotonicity layer)
 *   4) sampling decision → persist to DriverLocationSample if warranted
 *
 * If the DB claim itself throws (infrastructure outage), the first failure
 * aborts the batch by throwing DbClaimFailedError — the route wraps it in
 * a 500 INTERNAL_ERROR. Because the claim is idempotent, clients may safely
 * retry the entire batch.
 */
export async function processLocationBatch(
  driverId: string,
  samples: LocationSampleV2[],
  traceId: string
): Promise<LocationBatchResultV2> {
  const results: LocationSampleResultV2[] = [];
  const serverTimeMs = Date.now();
  let dbSampleWriteFailures = 0;
  let driverUpdateFailures = 0;

  // ---- Pre-batch: last DB sample (for sampling, rule 7) ----
  let lastSample = null;
  try {
    lastSample = await prisma.driverLocationSample.findFirst({
      where: { driverId },
      orderBy: { capturedAt: "desc" }
    });
  } catch {
    // Non-fatal — sampling decisions degrade to "always save"
  }

  // ---- Pre-batch: bulk DB dedup (fast path for already-sampled records) ----
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

  // ---- Per-sample processing ----
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // 1) Validate
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

    // 2) In-batch dedup
    const capturedAtMs = new Date(sample.capturedAt).getTime();
    if (existingCaptureTimes.has(capturedAtMs)) {
      results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
      continue;
    }
    existingCaptureTimes.add(capturedAtMs);

    // 3) DB high-water claim — idempotency authority
    let claimCount: number;
    try {
      const claimResult = await prisma.driver.updateMany({
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
      claimCount = claimResult.count;
    } catch {
      // DB infrastructure failure — the first one aborts the batch.
      // (If claimCount was already resolved as 0 on a prior iteration,
      //  this catch is for the updateMany itself throwing, not for
      //  count=0 — that is handled below via re-read.)
      log.error("DB high-water claim threw — aborting batch", {
        traceId,
        driverId,
        index: i
      });
      throw new DbClaimFailedError("DB claim failed", results);
    }

    if (claimCount !== 1) {
      // count=0 means another request already accepted this capturedAt or
      // a newer one. Reread to distinguish exact-duplicate vs out-of-order.
      let currentMark: Date | null = null;
      try {
        const d = await prisma.driver.findUnique({
          where: { id: driverId },
          select: { lastLocationCapturedAt: true }
        });
        currentMark = d?.lastLocationCapturedAt ?? null;
      } catch {
        // Can't determine — conservatively skip
        results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
        log.warn("Location sample skipped — high-water re-read failed", {
          traceId,
          driverId,
          index: i
        });
        continue;
      }

      if (currentMark) {
        const currentMs = currentMark.getTime();
        if (currentMs === capturedAtMs) {
          results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
          log.info("Location sample skipped — exact duplicate (cross-batch idempotent)", {
            traceId,
            driverId,
            index: i,
            capturedAtMs,
            dedup: "EXACT"
          });
          continue;
        }
        if (currentMs > capturedAtMs) {
          results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
          log.info("Location sample skipped — out-of-order (conservative skip, no regression)", {
            traceId,
            driverId,
            index: i,
            capturedAtMs,
            currentMs,
            dedup: "OUT_OF_ORDER"
          });
          continue;
        }
        // currentMs < capturedAtMs 但 count=0 — 异常竞态，保守跳过
        results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
        log.warn("Location sample skipped — claim anomaly (mark < sample but count=0)", {
          traceId,
          driverId,
          index: i,
          capturedAtMs,
          currentMs
        });
        continue;
      }

      // No mark after claim → driver may not exist; conservative skip
      results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
      continue;
    }

    // 4) Claim succeeded — this sample is the newest known.
    //    Write Redis CAS (cache monotonicity layer, best-effort).
    //    setDriverOnline is always called after a successful Redis CAS
    //    because the driver just sent a fresh location.
    const casOutcome = await setDriverLocationIfNewer(
      driverId,
      {
        lat: String(sample.lat),
        lng: String(sample.lng),
        accuracy: String(sample.accuracyMeters),
        ts: sample.capturedAt,
        server_ts: String(serverTimeMs),
        status: "ACTIVE"
      },
      capturedAtMs
    );

    if (casOutcome === "stale" || casOutcome === "duplicate") {
      // DB won the claim but Redis disagrees — the DB is authoritative.
      // Log so we can detect clock drift or cache state skew over time.
      log.warn("Redis CAS disagreed with DB claim (not actionable — DB is authority)", {
        traceId,
        driverId,
        index: i,
        casOutcome
      });
    }

    // setDriverOnline is always called after a successful DB claim;
    // a stale/duplicate CAS outcome does not block it — the driver is
    // observably online since it just sent a fresh batch.
    if (casOutcome !== "unavailable") {
      try {
        await setDriverOnline(driverId);
      } catch {
        // best-effort
      }
    }

    // 5) Sampling & history (rule 7)
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
      } catch (err) {
        // P2002 (unique constraint on driverId+capturedAt) is a race:
        // another concurrent request also accepted this sample.
        // Treat as DUPLICATE — not a write failure.
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
          log.info("Location sample skipped — concurrent P2002 on history write", {
            traceId,
            driverId,
            index: i
          });
          continue;
        }
        // Other persistence errors are best-effort
        dbSampleWriteFailures += 1;
        log.warn("Failed to persist location sample", {
          traceId,
          driverId,
          index: i
        });
      }
    }

    // No separate Driver.lastLat/lastLng write — the DB claim already
    // updated them atomically (step 3). driverUpdateFailures stays at 0
    // because a throw in step 3 aborts the batch; a re-read failure in
    // the count=0 branch either produces a skipped reason or throws.

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

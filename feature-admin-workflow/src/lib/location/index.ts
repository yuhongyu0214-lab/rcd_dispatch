import type {
  LocationSampleV2,
  LocationBatchResultV2,
  LocationSampleResultV2,
  LocationFreshnessV2
} from "@/types/v2";

import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_ETA_TTL_SECONDS,
  getDriverLocationWithStatus,
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
 *   2) lock Driver and enforce the DB high-water mark
 *   3) atomically persist 200m/120s history samples; when 200m movement or
 *      ETA-cache expiry triggers dispatch, increment planVersion and enqueue
 *      DRIVER_LOCATION_UPDATED in that same transaction
 *   4) after commit, update Redis CAS and immediately process a durable event
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
    let claimOutcome:
      | { accepted: true; dispatchEventId: string | null }
      | { accepted: false; currentMark: Date | null };
    try {
      claimOutcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Driver"
          WHERE "id" = ${driverId}
          FOR UPDATE
        `;

        const driver = await tx.driver.findUnique({
          where: { id: driverId },
          select: {
            id: true,
            lastLocationCapturedAt: true
          }
        });
        if (
          !driver ||
          (driver.lastLocationCapturedAt &&
            driver.lastLocationCapturedAt.getTime() >= capturedAtMs)
        ) {
          return {
            accepted: false as const,
            currentMark: driver?.lastLocationCapturedAt ?? null
          };
        }

        const [lastSample, lastDispatchEvent] = await Promise.all([
          tx.driverLocationSample.findFirst({
            where: { driverId },
            orderBy: { capturedAt: "desc" }
          }),
          tx.dispatchEventOutbox.findFirst({
            where: {
              driverId,
              type: "DRIVER_LOCATION_UPDATED"
            },
            orderBy: { occurredAt: "desc" },
            select: { occurredAt: true }
          })
        ]);
        const samplingDecision = shouldSaveSample(sample, lastSample, false);
        const lastDispatchAtMs =
          lastDispatchEvent?.occurredAt.getTime() ?? Number.NEGATIVE_INFINITY;
        const etaCacheExpired =
          capturedAtMs - lastDispatchAtMs >=
          DEFAULT_ETA_TTL_SECONDS * 1000;
        const shouldDispatch =
          samplingDecision.reason === "first_sample" ||
          samplingDecision.reason === "distance_moved" ||
          etaCacheExpired;
        const dispatchEventId = shouldDispatch
          ? `driver-location-updated:${driverId}:${capturedAtMs}`
          : null;

        await tx.driver.update({
          where: { id: driverId },
          data: {
            lastLat: sample.lat,
            lastLng: sample.lng,
            lastAccuracyMeters: sample.accuracyMeters,
            lastLocationCapturedAt: new Date(capturedAtMs),
            ...(dispatchEventId
              ? { planVersion: { increment: 1 } }
              : {})
          }
        });

        if (samplingDecision.shouldSample) {
          await tx.driverLocationSample.create({
            data: {
              driverId,
              lat: sample.lat,
              lng: sample.lng,
              accuracyMeters: sample.accuracyMeters,
              capturedAt: new Date(sample.capturedAt)
            }
          });
        }
        if (dispatchEventId) {
          await enqueueInternalEvent(tx, {
            eventId: dispatchEventId,
            type: "DRIVER_LOCATION_UPDATED",
            driverId,
            occurredAt: sample.capturedAt,
            traceId
          });
        }
        return { accepted: true as const, dispatchEventId };
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
        log.info(
          "Location sample skipped — concurrent history duplicate rolled back",
          {
            traceId,
            driverId,
            index: i
          }
        );
        continue;
      }
      // DB infrastructure failure — the first one aborts the batch.
      log.error("DB high-water claim threw — aborting batch", {
        traceId,
        driverId,
        index: i
      });
      throw new DbClaimFailedError("DB claim failed", results);
    }

    if (!claimOutcome.accepted) {
      const currentMark = claimOutcome.currentMark;
      if (currentMark) {
        const currentMs = currentMark.getTime();
        if (currentMs === capturedAtMs) {
          results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
          log.info(
            "Location sample skipped — exact duplicate (cross-batch idempotent)",
            {
              traceId,
              driverId,
              index: i,
              capturedAtMs,
              dedup: "EXACT"
            }
          );
          continue;
        }
        if (currentMs > capturedAtMs) {
          results.push({ index: i, status: "skipped", reason: "DUPLICATE" });
          log.info(
            "Location sample skipped — out-of-order (conservative skip, no regression)",
            {
              traceId,
              driverId,
              index: i,
              capturedAtMs,
              currentMs,
              dedup: "OUT_OF_ORDER"
            }
          );
          continue;
        }
      }

      // No mark means the driver disappeared between route validation and
      // this transaction. Conservatively skip without regressing state.
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
      log.warn(
        "Redis CAS disagreed with DB claim (not actionable — DB is authority)",
        {
          traceId,
          driverId,
          index: i,
          casOutcome
        }
      );
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

    // Process only significant location changes, after the realtime cache has
    // observed the accepted sample. Redis failure is safe because snapshot
    // construction falls back to the transactionally-updated Driver row.
    if (claimOutcome.dispatchEventId) {
      try {
        await processInternalEvent(claimOutcome.dispatchEventId);
      } catch (error) {
        log.error("Location dispatch event processing failed; outbox retained", {
          dispatchEventId: claimOutcome.dispatchEventId,
          traceId,
          driverId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // The latest location is always updated. History follows the 200m/120s
    // sampling rule; dispatch follows 200m/ETA-cache-expiry. Any triggered
    // version increment and outbox write share the same transaction (step 3).

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

  // Try Redis first. The read establishes a lazy connection when needed.
  try {
    const { location: redisLocation } =
      await getDriverLocationWithStatus(driverId);
    if (redisLocation?.ts) {
      return calculateFreshness(redisLocation.ts, serverTimeMs).freshness;
    }
  } catch {
    // Fall through to DB fallback
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
export async function isCandidateDriver(driverId: string): Promise<boolean> {
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

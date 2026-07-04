import { getEtaMinutes } from "@/lib/amap";
import { cacheEta as redisCacheEta, getCachedEta } from "@/lib/redis";

import { dispatchLog } from "./log";
import { ETA_EXCEEDED_MINUTES } from "./rules";
import type { DispatchCoordinate, EtaResult } from "./types";

const ETA_FAILURE_MINUTES = 9999;

/**
 * Calculate ETA for a list of pre-screened candidates.
 *
 * Strategy (per docs/production-amap-strategy.md 3.4):
 * 1. Check Redis cache: eta:{orderId}:{driverId}:driving
 * 2. Cache miss → call amap.ts drivingRoute()
 * 3. Write result to Redis cache, TTL 60s
 * 4. On AMap failure → ETA=9999, etaStatus=FALLBACK
 * 5. ETA >= 120 minutes → etaStatus=EXCEEDED
 *
 * @param orderId - Order ID for cache key construction
 * @param candidates - Pre-screened candidates (already limited to Top K)
 * @param destination - Order destination (pickup point)
 * @param traceId - For log correlation
 */
export async function getEtaResults(input: {
  orderId: string;
  candidates: Array<{
    driverId: string;
    driverStatus: string;
    origin: DispatchCoordinate | null;
  }>;
  destination: DispatchCoordinate | null;
  traceId?: string;
}): Promise<EtaResult[]> {
  if (!input.destination) {
    dispatchLog.warn("dispatch_eta_no_destination", {
      traceId: input.traceId ?? null,
      orderId: input.orderId,
      candidateCount: String(input.candidates.length)
    });
    return input.candidates.map((c) => ({
      driverId: c.driverId,
      etaMinutes: ETA_FAILURE_MINUTES,
      distanceMeters: 0,
      durationSeconds: 0,
      etaStatus: "FALLBACK"
    }));
  }

  const results: EtaResult[] = [];

  for (const candidate of input.candidates) {
    const { driverId, driverStatus, origin } = candidate;

    try {
      // 1. Check Redis cache first
      const cached = await getCachedEta(input.orderId, driverId);

      if (cached) {
        dispatchLog.info("dispatch_eta_cache_hit", {
          traceId: input.traceId ?? null,
          orderId: input.orderId,
          driverId,
          etaMinutes: String(cached.etaMinutes)
        });
        results.push({
          driverId,
          etaMinutes: cached.etaMinutes,
          distanceMeters: cached.distanceMeters,
          durationSeconds: cached.durationSeconds,
          etaStatus: cached.etaMinutes >= ETA_EXCEEDED_MINUTES ? "EXCEEDED" : "NORMAL"
        });
        continue;
      }

      // 2. Cache miss → call amap.ts getEtaMinutes()
      const etaResult = await getEtaMinutes(
        origin,
        input.destination as DispatchCoordinate,
        driverStatus,
        driverId
      );

      // 3. Write to Redis cache (TTL 60s)
      await redisCacheEta(input.orderId, driverId, {
        driverId,
        orderId: input.orderId,
        etaMinutes: etaResult.etaMinutes,
        distanceMeters: etaResult.distanceMeters,
        durationSeconds: etaResult.durationSeconds,
        etaStatus: etaResult.etaStatus,
        cachedAt: Date.now()
      });

      results.push({
        driverId,
        etaMinutes: etaResult.etaMinutes,
        distanceMeters: etaResult.distanceMeters,
        durationSeconds: etaResult.durationSeconds,
        etaStatus: etaResult.etaMinutes >= ETA_EXCEEDED_MINUTES ? "EXCEEDED" : etaResult.etaStatus
      });
    } catch (err) {
      // 4. Unexpected error (should not happen — getEtaMinutes handles its own errors)
      dispatchLog.warn("dispatch_eta_unexpected_error", {
        traceId: input.traceId ?? null,
        driverId,
        reason: String(err)
      });
      results.push({
        driverId,
        etaMinutes: ETA_FAILURE_MINUTES,
        distanceMeters: 0,
        durationSeconds: 0,
        etaStatus: "FALLBACK"
      });
    }
  }

  return results;
}

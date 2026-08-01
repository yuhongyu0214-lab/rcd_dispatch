import type { GeoPointV2 } from "@/types/v2";
import type { DispatchInputV2 } from "@/types/v2/dispatch";
import type { EtaResolver } from "../core/types";

import { drivingRoute, durationToMinutes } from "@/lib/amap";
import {
  normalizePointHash,
  getCachedEtaV2,
  cacheEtaV2,
  DEFAULT_ETA_TTL_SECONDS
} from "@/lib/redis";
import type { EtaCacheValueV2 } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Frozen constants
// ---------------------------------------------------------------------------

/** Travel mode used for all ETA cache keys — every leg is a driving route. */
const MODE = "driving";

/** Separator between origin and destination hashes in the lookup map key. */
const KEY_SEP = "|";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface EtaPair {
  from: GeoPointV2;
  to: GeoPointV2;
  fromHash: string;
  toHash: string;
}

// ---------------------------------------------------------------------------
// Position collection
// ---------------------------------------------------------------------------

/**
 * Build a hash-keyed set of unique positions.
 *
 * Uses `normalizePointHash` (6-decimal rounding) so that coordinates that
 * differ by <0.1 m share the same key — preventing duplicate ETA queries
 * for practically-identical locations.
 */
function uniquePositions(
  points: Array<GeoPointV2 | undefined>
): Map<string, GeoPointV2> {
  const map = new Map<string, GeoPointV2>();
  for (const p of points) {
    if (p != null) {
      const hash = normalizePointHash(p);
      if (!map.has(hash)) map.set(hash, p);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Pair collection
// ---------------------------------------------------------------------------

/**
 * Collect all unique (from, to) pairs the core may query during slot planning.
 *
 * The core's EtaResolver is called for:
 *   DEADHEAD  — driver.lastLocation (or prior order.deliveryLocation) → next order.pickupLocation
 *   SERVICE   — order.pickupLocation → order.deliveryLocation
 *
 * Every plan-pool order delivery is a possible cursor created during this
 * planning run, so all delivery → pickup combinations must be present before
 * the synchronous core starts.
 */
function collectPairs(input: DispatchInputV2): EtaPair[] {
  const deadheadOrigins: GeoPointV2[] = [];

  // Driver lastLocation → deadhead origin
  for (const d of input.drivers) {
    if (d.lastLocation) deadheadOrigins.push(d.lastLocation);
    for (const assignment of d.assignments) {
      if (assignment.deliveryLocation) {
        deadheadOrigins.push(assignment.deliveryLocation);
      }
    }
  }

  // Extract order positions while building the full position set.
  const pickups: GeoPointV2[] = [];

  for (const o of input.orders) {
    if (o.pickupLocation) pickups.push(o.pickupLocation);
    if (o.deliveryLocation) {
      // An order's deliveryLocation is also a deadhead origin — after
      // completing slot A at this location, the driver can deadhead to
      // another order's pickup.
      deadheadOrigins.push(o.deliveryLocation);
    }
  }

  // Deduplicate by normalized hash.
  const deadheadOriginMap = uniquePositions(deadheadOrigins);
  const pickupMap = uniquePositions(pickups);

  // Build unique pairs with dedup.
  const seen = new Set<string>();
  const pairs: EtaPair[] = [];

  function addPair(from: GeoPointV2, to: GeoPointV2): void {
    const fh = normalizePointHash(from);
    const th = normalizePointHash(to);
    const key = `${fh}${KEY_SEP}${th}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ from, to, fromHash: fh, toHash: th });
    }
  }

  // Deadhead: include every possible cursor that the core can use.
  const requiredOrigins = [...deadheadOriginMap.values()].sort((a, b) =>
    normalizePointHash(a).localeCompare(normalizePointHash(b))
  );
  for (const to of pickupMap.values()) {
    for (const from of requiredOrigins) {
      addPair(from, to);
    }
  }

  // Service: per-order pickup → delivery
  // The core only queries each order's own service leg — a Cartesian product
  // of all pickups × all deliveries would generate pairs the core never consumes.
  for (const o of input.orders) {
    if (o.pickupLocation && o.deliveryLocation) {
      addPair(o.pickupLocation, o.deliveryLocation);
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-compute an ETA matrix for the given dispatch input snapshot.
 *
 * Returns a synchronous `EtaResolver` closure backed by an in-memory lookup
 * map. The caller injects this resolver into `runDispatchV2()`.
 *
 * Hard constraints (frozen 2026-07-19):
 * - Calls `drivingRoute()` directly — NEVER calls `getEtaMinutes()` (which
 *   would generate fallback/9999 sentinel values).
 * - Only caches REAL successful Amap results. Failures are not cached.
 * - Redis unavailable / Amap failure / missing key / timeout / no-route /
 *   invalid response → that specific pair returns `null` from the resolver.
 * - All Amap and Redis calls happen outside any database transaction.
 * - Cache TTL defaults to 60 s; Gate 3 does not use custom TTLs.
 * - Does NOT modify the pure computation core.
 */
export async function buildEtaMatrix(
  input: DispatchInputV2
): Promise<EtaResolver> {
  // 1. Collect unique (from, to) pairs the core may query.
  const pairs = collectPairs(input);

  if (pairs.length === 0) {
    return () => null;
  }

  // 2. Batch-check Redis cache.
  const cacheResults = await Promise.all(
    pairs.map(async (p) => {
      const cached = await getCachedEtaV2(p.fromHash, p.toHash, MODE);
      return { pair: p, cached };
    })
  );

  const lookup = new Map<string, number>();
  const misses: EtaPair[] = [];

  for (const { pair, cached } of cacheResults) {
    const key = `${pair.fromHash}${KEY_SEP}${pair.toHash}`;
    if (cached !== null) {
      lookup.set(key, cached.etaMinutes);
    } else {
      misses.push(pair);
    }
  }

  // 3. Call Amap for cache misses (parallel, outside any DB transaction).
  if (misses.length > 0) {
    const amapResults = await Promise.allSettled(
      misses.map(async (p) => {
        const route = await drivingRoute(p.from, p.to);
        const etaMinutes = durationToMinutes(route.duration);
        return { pair: p, etaMinutes, route };
      })
    );

    // 4. Populate lookup map + fire-and-forget Redis writes.
    const cacheWrites: Promise<void>[] = [];

    for (const result of amapResults) {
      if (result.status === "fulfilled") {
        const { pair, etaMinutes, route } = result.value;
        lookup.set(`${pair.fromHash}${KEY_SEP}${pair.toHash}`, etaMinutes);

        const cacheValue: EtaCacheValueV2 = {
          etaMinutes,
          distanceMeters: route.distance,
          durationSeconds: route.duration,
          cachedAt: Date.now()
        };

        cacheWrites.push(
          cacheEtaV2(
            pair.fromHash,
            pair.toHash,
            MODE,
            cacheValue,
            DEFAULT_ETA_TTL_SECONDS
          )
        );
      }
      // status === "rejected" → Amap unavailable for this pair.
      // Don't write to lookup; don't cache to Redis. Resolver returns null.
    }

    // Best-effort: Redis write failures must not prevent the resolver
    // from working (the in-memory lookup is already populated).
    await Promise.allSettled(cacheWrites);
  }

  // 5. Return synchronous EtaResolver closure.
  return (from: GeoPointV2, to: GeoPointV2): number | null => {
    if (!from || !to) return null;
    const key = `${normalizePointHash(from)}${KEY_SEP}${normalizePointHash(to)}`;
    return lookup.get(key) ?? null;
  };
}

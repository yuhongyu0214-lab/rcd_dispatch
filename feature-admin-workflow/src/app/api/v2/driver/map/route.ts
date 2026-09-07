import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { calculateFreshness } from "@/lib/location/freshness";
import { prisma } from "@/lib/prisma";
import { getDriverLocationsWithStatus, type DriverLocation } from "@/lib/redis";

import { extractDriverId } from "../../../driver/_utils";

import type { DriverV2, DriverLocationV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

interface ResolvedLocationSnapshot {
  location: DriverLocationV2;
  capturedAtMs: number;
}

/**
 * GET /api/v2/driver/map
 *
 * Returns all on-shift driver locations for the map view.
 * Coordinates AND freshness come from the SAME location snapshot
 * (Redis if available for that driver, otherwise DB fallback).
 *
 * P0-3: requires an authenticated driver session — real-time driver
 * locations must never be exposed anonymously.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // Auth: JWT Bearer token or web session with a linked driver
  const callerDriverId = await extractDriverId(request);

  if (!callerDriverId) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Driver authentication required"),
      { traceId }
    );
  }

  // ---- Data: drivers, Redis locations, open shifts (2 batch calls) ----
  const drivers = await prisma.driver.findMany({
    where: { onShift: true, isActive: true },
    select: {
      id: true,
      name: true,
      onShift: true,
      availability: true,
      planVersion: true,
      lastLat: true,
      lastLng: true,
      lastAccuracyMeters: true,
      lastLocationCapturedAt: true,
      store: { select: { code: true } }
    }
  });

  const driverIds = drivers.map((d) => d.id);

  const [redisBatch, shifts] = await Promise.all([
    getDriverLocationsWithStatus(driverIds),
    prisma.driverShift.findMany({
      where: { driverId: { in: driverIds }, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { driverId: true, startedAt: true }
    })
  ]);

  // Index shifts by driverId (take the newest per driver)
  const shiftByDriver = new Map<string, Date>();
  for (const s of shifts) {
    if (!shiftByDriver.has(s.driverId)) {
      shiftByDriver.set(s.driverId, s.startedAt);
    }
  }

  const serverTimeMs = Date.now();

  // ---- Per-driver view: newest complete same-source snapshot rule ----
  const driverViews: DriverV2[] = drivers.map((d) => {
    let freshness: "FRESH" | "STALE" | "NONE" = "NONE";
    let lastLocation: DriverLocationV2 | undefined;

    const redisSnapshot = redisBatch.redisAvailable
      ? resolveRedisSnapshot(redisBatch.locations.get(d.id) ?? null)
      : null;
    const dbSnapshot = resolveDbSnapshot(
      d.lastLat,
      d.lastLng,
      d.lastAccuracyMeters,
      d.lastLocationCapturedAt
    );

    // A Redis CAS outage can leave DB newer than Redis. Select one whole
    // snapshot by capturedAt so map reads match dispatch without mixing fields.
    const selectedSnapshot = selectNewestSnapshot(redisSnapshot, dbSnapshot);

    if (selectedSnapshot) {
      lastLocation = selectedSnapshot.location;
      freshness = calculateFreshness(
        selectedSnapshot.location.capturedAt,
        serverTimeMs
      ).freshness;
    } else if (d.lastLocationCapturedAt) {
      // Per frozen contract §3.3: omit the ENTIRE lastLocation when partial.
      freshness = calculateFreshness(
        d.lastLocationCapturedAt.toISOString(),
        serverTimeMs
      ).freshness;
    }

    const shiftStartedAt = shiftByDriver.get(d.id);

    return {
      id: d.id,
      name: d.name,
      storeCode: d.store.code,
      onShift: d.onShift,
      shiftStartedAt: shiftStartedAt?.toISOString(),
      availability: d.availability,
      planVersion: d.planVersion,
      locationFreshness: freshness,
      lastLocation,
      slots: {}
    };
  });

  return okV2(driverViews, { traceId });
}

/** True if the Redis hash has all fields needed for a DriverLocationV2. */
function hasCompleteFields(loc: DriverLocation): boolean {
  return (
    typeof loc.lat === "string" &&
    loc.lat.length > 0 &&
    typeof loc.lng === "string" &&
    loc.lng.length > 0 &&
    typeof loc.accuracy === "string" &&
    loc.accuracy.length > 0 &&
    typeof loc.ts === "string" &&
    loc.ts.length > 0
  );
}

function resolveRedisSnapshot(
  loc: DriverLocation | null
): ResolvedLocationSnapshot | null {
  if (!loc || !hasCompleteFields(loc)) return null;

  const lat = Number.parseFloat(loc.lat);
  const lng = Number.parseFloat(loc.lng);
  const accuracyMeters = Number.parseFloat(loc.accuracy ?? "");
  const capturedAtMs = Date.parse(loc.ts);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracyMeters) ||
    !Number.isFinite(capturedAtMs)
  ) {
    return null;
  }

  return {
    location: { lat, lng, accuracyMeters, capturedAt: loc.ts },
    capturedAtMs
  };
}

function resolveDbSnapshot(
  lat: number | null,
  lng: number | null,
  accuracyMeters: number | null,
  capturedAt: Date | null
): ResolvedLocationSnapshot | null {
  if (
    lat == null ||
    lng == null ||
    accuracyMeters == null ||
    capturedAt == null
  ) {
    return null;
  }

  const capturedAtMs = capturedAt.getTime();
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracyMeters) ||
    !Number.isFinite(capturedAtMs)
  ) {
    return null;
  }

  return {
    location: {
      lat,
      lng,
      accuracyMeters,
      capturedAt: capturedAt.toISOString()
    },
    capturedAtMs
  };
}

function selectNewestSnapshot(
  redisSnapshot: ResolvedLocationSnapshot | null,
  dbSnapshot: ResolvedLocationSnapshot | null
): ResolvedLocationSnapshot | null {
  if (!redisSnapshot) return dbSnapshot;
  if (!dbSnapshot) return redisSnapshot;
  return redisSnapshot.capturedAtMs >= dbSnapshot.capturedAtMs
    ? redisSnapshot
    : dbSnapshot;
}

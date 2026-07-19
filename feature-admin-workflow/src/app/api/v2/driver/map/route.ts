import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { calculateFreshness } from "@/lib/location/freshness";
import { prisma } from "@/lib/prisma";
import {
  getDriverLocationsWithStatus,
  type DriverLocation
} from "@/lib/redis";

import { extractDriverId } from "../../../driver/_utils";

import type { DriverV2, DriverLocationV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

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
  const traceId =
    request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

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

  // ---- Per-driver view: same-source snapshot rule ----
  const driverViews: DriverV2[] = drivers.map((d) => {
    let freshness: "FRESH" | "STALE" | "NONE" = "NONE";
    let lastLocation: DriverLocationV2 | undefined;

    if (redisBatch.redisAvailable) {
      // Redis is the primary store — try to build the view entirely
      // from the Redis snapshot for this driver (same-source rule).
      const loc = redisBatch.locations.get(d.id) ?? null;

      if (loc && hasCompleteFields(loc)) {
        const lat = parseFloat(loc.lat);
        const lng = parseFloat(loc.lng);
        const accuracyMeters = parseFloat(loc.accuracy ?? "0");

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Number.isFinite(accuracyMeters)
        ) {
          lastLocation = {
            lat,
            lng,
            accuracyMeters,
            capturedAt: loc.ts
          };
          freshness = calculateFreshness(loc.ts, serverTimeMs).freshness;
        }
      }
      // Individual miss (loc === null) or incomplete fields —
      // fall through to DB backup below WITHOUT mixing sources.
    }

    if (!redisBatch.redisAvailable || lastLocation === undefined) {
      // Redis unavailable or this driver had no usable Redis snapshot.
      // Entire view comes from DB snapshot (same-source for this path).
      if (
        d.lastLat != null &&
        d.lastLng != null &&
        d.lastAccuracyMeters != null &&
        d.lastLocationCapturedAt != null
      ) {
        lastLocation = {
          lat: d.lastLat,
          lng: d.lastLng,
          accuracyMeters: d.lastAccuracyMeters,
          capturedAt: d.lastLocationCapturedAt.toISOString()
        };
        freshness = calculateFreshness(
          d.lastLocationCapturedAt.toISOString(),
          serverTimeMs
        ).freshness;
      } else {
        // Per frozen contract §3.3: omit the ENTIRE lastLocation
        lastLocation = undefined;
        if (d.lastLocationCapturedAt) {
          freshness = calculateFreshness(
            d.lastLocationCapturedAt.toISOString(),
            serverTimeMs
          ).freshness;
        }
        // else freshness stays "NONE"
      }
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

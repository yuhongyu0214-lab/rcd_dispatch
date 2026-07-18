import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { getDriverLocationFreshness } from "@/lib/location";
import { prisma } from "@/lib/prisma";

import { extractDriverId } from "../../../driver/_utils";

import type { DriverV2, DriverLocationV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/driver/map
 *
 * Returns all on-shift driver locations for the map view.
 * Each driver includes location freshness, last known position,
 * and shift start time.
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

  const driverViews: DriverV2[] = await Promise.all(
    drivers.map(async (d) => {
      const freshness = await getDriverLocationFreshness(d.id);

      // Frozen contract §3.3: `lastLocation` is optional as a WHOLE, but its
      // inner fields (lat/lng/accuracyMeters/capturedAt) are all required.
      // P0-3: never fabricate data — when accuracy or capture time is unknown
      // in the DB, omit the ENTIRE lastLocation object instead of filling in
      // 0 / "". Semantically consistent too: a fix without capture time
      // cannot be freshness-assessed anyway.
      const lastLocation: DriverLocationV2 | undefined =
        d.lastLat != null &&
        d.lastLng != null &&
        d.lastAccuracyMeters != null &&
        d.lastLocationCapturedAt != null
          ? {
              lat: d.lastLat,
              lng: d.lastLng,
              accuracyMeters: d.lastAccuracyMeters,
              capturedAt: d.lastLocationCapturedAt.toISOString()
            }
          : undefined;

      // Find active shift for shiftStartedAt
      const shift = await prisma.driverShift.findFirst({
        where: { driverId: d.id, endedAt: null },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true }
      });

      return {
        id: d.id,
        name: d.name,
        storeCode: d.store.code,
        onShift: d.onShift,
        shiftStartedAt: shift?.startedAt.toISOString(),
        availability: d.availability,
        planVersion: d.planVersion,
        locationFreshness: freshness,
        lastLocation,
        slots: {}
      };
    })
  );

  return okV2(driverViews, { traceId });
}

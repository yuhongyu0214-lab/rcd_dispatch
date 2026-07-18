import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { getDriverLocationFreshness } from "@/lib/location";
import { prisma } from "@/lib/prisma";

import type { DriverV2, DriverLocationV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/driver/map
 *
 * Returns all on-shift driver locations for the map view.
 * Each driver includes location freshness, last known position,
 * and shift start time.
 *
 * No authentication required — this is a read-only map endpoint.
 */
export async function GET(_request: NextRequest): Promise<Response> {
  const traceId =
    _request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  const drivers = await prisma.driver.findMany({
    where: { onShift: true, isActive: true },
    select: {
      id: true,
      name: true,
      storeId: true,
      onShift: true,
      availability: true,
      planVersion: true,
      lastLat: true,
      lastLng: true,
      lastAccuracyMeters: true,
      lastLocationCapturedAt: true
    }
  });

  const driverViews: DriverV2[] = await Promise.all(
    drivers.map(async (d) => {
      const freshness = await getDriverLocationFreshness(d.id);

      const lastLocation: DriverLocationV2 | undefined =
        d.lastLat != null && d.lastLng != null
          ? {
              lat: d.lastLat,
              lng: d.lastLng,
              accuracyMeters: d.lastAccuracyMeters ?? 0,
              capturedAt: d.lastLocationCapturedAt?.toISOString() ?? ""
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
        storeCode: d.storeId,
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

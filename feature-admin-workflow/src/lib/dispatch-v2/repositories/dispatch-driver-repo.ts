import { prisma } from "@/lib/prisma";
import type { DispatchableDriverRow } from "./types";

/**
 * Batch-read drivers for the given stores.
 *
 * All active drivers are included regardless of onShift/availability so that
 * the snapshot can surface drivers who hold protected assignments but are
 * temporarily unavailable. The core filters non-dispatchable drivers via
 * the onShift / availability fields on DispatchDriverInputV2.
 *
 * If a non-empty `driverIds` list is provided, the result is further narrowed
 * to only those drivers (in-memory, not an additional DB round-trip).
 */
export async function findDispatchableDrivers(params: {
  storeIds: string[];
  driverIds?: string[];
}): Promise<DispatchableDriverRow[]> {
  const { storeIds, driverIds } = params;

  if (storeIds.length === 0) return [];

  const rows = await prisma.driver.findMany({
    where: {
      storeId: { in: storeIds },
      isActive: true,
    },
    select: {
      id: true,
      onShift: true,
      availability: true,
      planVersion: true,
      lastLat: true,
      lastLng: true,
      lastAccuracyMeters: true,
      lastLocationCapturedAt: true,
      store: { select: { code: true } },
    },
  });

  const mapped: DispatchableDriverRow[] = rows.map((r) => ({
    id: r.id,
    storeCode: r.store.code,
    onShift: r.onShift,
    availability: r.availability,
    planVersion: r.planVersion,
    lastLat: r.lastLat,
    lastLng: r.lastLng,
    lastAccuracyMeters: r.lastAccuracyMeters,
    lastLocationCapturedAt: r.lastLocationCapturedAt,
  }));

  if (driverIds && driverIds.length > 0) {
    const idSet = new Set(driverIds);
    return mapped.filter((d) => idSet.has(d.id));
  }

  return mapped;
}

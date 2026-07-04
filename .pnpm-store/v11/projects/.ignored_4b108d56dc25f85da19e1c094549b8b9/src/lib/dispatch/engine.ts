import { prisma } from "@/lib/prisma";

import { applyDispatchConstraints, buildNoDriverResult } from "./constraints";
import { getEtaResults } from "./eta";
import { filterDispatchCandidates, type DriverForDispatch } from "./filter";
import { dispatchLog } from "./log";
import { ACTIVE_ASSIGNMENT_STATUSES, DISPATCHABLE_DRIVER_STATUSES } from "./rules";
import { rankDispatchCandidates } from "./sort";
import type { DispatchCoordinate, DispatchResult } from "./types";

/**
 * Maximum number of candidates to call AMap ETA for (Top K).
 * Per docs/production-amap-strategy.md 3.4.
 */
const TOP_K_FOR_ETA = 5;

function hasCoordinate(lat: number | null, lng: number | null) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

function getOrderDestination(order: {
  pickupLat: number | null;
  pickupLng: number | null;
  returnLat: number | null;
  returnLng: number | null;
}): DispatchCoordinate | null {
  if (hasCoordinate(order.pickupLat, order.pickupLng)) {
    return {
      lat: order.pickupLat ?? 0,
      lng: order.pickupLng ?? 0
    };
  }

  if (hasCoordinate(order.returnLat, order.returnLng)) {
    return {
      lat: order.returnLat ?? 0,
      lng: order.returnLng ?? 0
    };
  }

  return null;
}

/**
 * Run the full dispatch recommendation pipeline.
 *
 * Pipeline:
 * 1. Query order + all active drivers (same store + nearby)
 * 2. Build origins map from vehicle GPS + driver lastLat/lastLng
 * 3. Pre-screen with filterDispatchCandidates (Redis online check + Haversine + load)
 * 4. Sort pre-screened candidates by distance, take Top K=5
 * 5. Call ETA (Redis cache → AMap) for Top K
 * 6. Final ranking with sort (ETA + distance + store match + load)
 * 7. Apply dispatch constraints (MANUAL if ETA >= 120, PENDING if no drivers)
 *
 * @param orderId - Order to find drivers for
 * @param topNLimit - Number of candidates to return (default 3)
 * @param traceId - For log correlation
 */
export async function runDispatch(
  orderId: string,
  topNLimit = 3,
  traceId?: string
): Promise<DispatchResult> {
  // 1. Query order info
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      currentAssignment: {
        select: {
          driverId: true
        }
      },
      store: { select: { id: true, name: true } }
    }
  });

  if (!order) {
    dispatchLog.warn("dispatch_order_not_found", {
      traceId: traceId ?? null,
      orderId
    });
    return buildNoDriverResult({
      orderId,
      orderNo: "",
      orderType: "STORE_PICKUP"
    });
  }

  // Only dispatch for specific statuses
  const allowedStatuses = ["PENDING", "RECOMMENDING", "ASSIGNED", "ACCEPTED"] as const;
  if (!allowedStatuses.includes(order.status as (typeof allowedStatuses)[number])) {
    dispatchLog.warn("dispatch_order_invalid_status", {
      traceId: traceId ?? null,
      orderId: order.id,
      status: order.status
    });
    return buildNoDriverResult({
      orderId: order.id,
      orderNo: order.orderNo,
      orderType: order.type
    });
  }

  // 2. Query all active drivers (same store + nearby for proximity matching)
  const allDrivers = await prisma.driver.findMany({
    where: {
      isActive: true,
      status: {
        in: DISPATCHABLE_DRIVER_STATUSES
      }
    },
    include: {
      store: { select: { id: true, name: true } },
      assignments: {
        where: {
          status: { in: ACTIVE_ASSIGNMENT_STATUSES }
        },
        include: {
          order: { select: { type: true } }
        }
      }
    }
  });

  dispatchLog.info("dispatch_drivers_queried", {
    traceId: traceId ?? null,
    orderId: order.id,
    totalDrivers: String(allDrivers.length)
  });

  // Build origins map from vehicle GPS data (same-store vehicles first)
  const originsByDriverId = new Map<string, DispatchCoordinate | null>();
  const vehicles = await prisma.vehicle.findMany({
    where: {
      storeId: order.storeId,
      isActive: true,
      gpsLat: { not: null },
      gpsLng: { not: null }
    },
    select: {
      gpsLat: true,
      gpsLng: true
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  // Helper to access lastLat/lastLng from Prisma include result (TS inference edge case)
  function getDriverLastLocation(d: typeof allDrivers[number]): { lastLat: number | null; lastLng: number | null } {
    const raw = d as unknown as Record<string, unknown>;
    return {
      lastLat: (raw.lastLat as number) ?? null,
      lastLng: (raw.lastLng as number) ?? null
    };
  }

  allDrivers.forEach((driver, index) => {
    const vehicle = vehicles[index % Math.max(vehicles.length, 1)];
    const { lastLat, lastLng } = getDriverLastLocation(driver);
    const origin =
      vehicle && hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)
        ? {
            lat: vehicle.gpsLat ?? 0,
            lng: vehicle.gpsLng ?? 0
          }
        : // Fallback: use driver's last known location
        hasCoordinate(lastLat, lastLng)
          ? {
              lat: lastLat ?? 0,
              lng: lastLng ?? 0
            }
          : null;

    originsByDriverId.set(driver.id, origin);
  });

  // 3. Pre-screen drivers with Redis online check + Haversine + load
  const typedDrivers: DriverForDispatch[] = allDrivers.map((d) => {
    const { lastLat, lastLng } = getDriverLastLocation(d);
    return {
      id: d.id,
      name: d.name,
      phone: d.phone,
      status: d.status,
      storeId: d.storeId,
      lastLat,
      lastLng,
      store: d.store,
      assignments: d.assignments.map((a) => ({
        status: a.status,
        order: { type: a.order.type }
      }))
    };
  });

  const { candidates } = await filterDispatchCandidates({
    orderType: order.type,
    orderStoreId: order.storeId,
    orderLat: order.pickupLat ?? null,
    orderLng: order.pickupLng ?? null,
    drivers: typedDrivers,
    originsByDriverId
  });

  // Exclude current assigned driver from candidates
  const filteredCandidates = candidates.filter(
    (c) => c.driverId !== order.currentAssignment?.driverId
  );

  dispatchLog.info("dispatch_run_started", {
    traceId: traceId ?? null,
    orderId: order.id,
    orderNo: order.orderNo,
    candidateCount: String(filteredCandidates.length)
  });

  if (filteredCandidates.length === 0) {
    return buildNoDriverResult({
      orderId: order.id,
      orderNo: order.orderNo,
      orderType: order.type
    });
  }

  // 4. Sort pre-screened by distance, take Top K=5 for ETA calls
  const preSorted = [...filteredCandidates].sort(
    (a, b) => a.distanceKm - b.distanceKm
  );
  const topKForEta = preSorted.slice(0, TOP_K_FOR_ETA);

  dispatchLog.info("dispatch_topk_selected", {
    traceId: traceId ?? null,
    orderId: order.id,
    topK: String(topKForEta.length),
    totalCandidates: String(filteredCandidates.length)
  });

  // 5. Call ETA for Top K (Redis cache → AMap)
  const destination = getOrderDestination(order);
  const etaResults = await getEtaResults({
    orderId: order.id,
    candidates: topKForEta.map((c) => ({
      driverId: c.driverId,
      driverStatus: c.driverStatus,
      origin: c.origin
    })),
    destination,
    traceId
  });

  // Build combined candidate list: Top K with ETA + remaining with fallback
  const topKDriverIds = new Set(topKForEta.map((c) => c.driverId));
  const allEtaResults = [
    ...etaResults,
    // Remaining candidates get fallback ETA
    ...filteredCandidates
      .filter((c) => !topKDriverIds.has(c.driverId))
      .map((c) => ({
        driverId: c.driverId,
        etaMinutes: 9999,
        distanceMeters: 0,
        durationSeconds: 0,
        etaStatus: "FALLBACK" as const
      }))
  ];

  // 6. Final ranking
  const topN = rankDispatchCandidates({
    orderType: order.type,
    orderStoreId: order.storeId,
    candidates: filteredCandidates,
    etaResults: allEtaResults,
    topNLimit
  });

  // 7. Apply dispatch constraints
  const result = applyDispatchConstraints({
    orderId: order.id,
    orderNo: order.orderNo,
    orderType: order.type,
    topN
  });

  dispatchLog.info("dispatch_run_finished", {
    traceId: traceId ?? null,
    orderId: order.id,
    outcome: result.outcome,
    reason: result.reason ?? "none",
    topCandidateCount: String(result.topN.length)
  });

  return result;
}

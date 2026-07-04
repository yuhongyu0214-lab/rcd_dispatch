import { prisma } from "@/lib/prisma";

import { applyDispatchConstraints, buildNoDriverResult } from "./constraints";
import { getEtaResults } from "./eta";
import { filterDispatchCandidates } from "./filter";
import { dispatchLog } from "./log";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  DISPATCHABLE_DRIVER_STATUSES
} from "./rules";
import { rankDispatchCandidates } from "./sort";
import type { DispatchCoordinate, DispatchResult } from "./types";

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

export async function runDispatch(
  orderId: string,
  topNLimit = 3,
  traceId?: string
): Promise<DispatchResult> {
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
    return buildNoDriverResult({
      orderId,
      orderNo: "",
      orderType: "STORE_PICKUP"
    });
  }

  if (
    order.status !== "PENDING" &&
    order.status !== "RECOMMENDING" &&
    order.status !== "ASSIGNED" &&
    order.status !== "ACCEPTED"
  ) {
    return buildNoDriverResult({
      orderId: order.id,
      orderNo: order.orderNo,
      orderType: order.type
    });
  }

  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({
      where: {
        storeId: order.storeId,
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
    }),
    prisma.vehicle.findMany({
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
    })
  ]);

  const originsByDriverId = new Map<string, DispatchCoordinate | null>();

  drivers.forEach((driver, index) => {
    const vehicle = vehicles[index % Math.max(vehicles.length, 1)];
    const origin =
      vehicle && hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)
        ? {
            lat: vehicle.gpsLat ?? 0,
            lng: vehicle.gpsLng ?? 0
          }
        : null;

    originsByDriverId.set(driver.id, origin);
  });

  const candidates = filterDispatchCandidates({
    orderType: order.type,
    drivers,
    originsByDriverId
  }).filter((candidate) => candidate.driverId !== order.currentAssignment?.driverId);

  dispatchLog.info({
    traceId: traceId ?? null,
    orderId: order.id,
    orderNo: order.orderNo,
    candidateCount: candidates.length
  }, "dispatch_run_started");

  if (candidates.length === 0) {
    return buildNoDriverResult({
      orderId: order.id,
      orderNo: order.orderNo,
      orderType: order.type
    });
  }

  const etaResults = await getEtaResults({
    candidates,
    destination: getOrderDestination(order),
    traceId
  });
  const topN = rankDispatchCandidates({
    orderType: order.type,
    candidates,
    etaResults,
    topNLimit
  });
  const result = applyDispatchConstraints({
    orderId: order.id,
    orderNo: order.orderNo,
    orderType: order.type,
    topN
  });

  dispatchLog.info({
    traceId: traceId ?? null,
    orderId: order.id,
    outcome: result.outcome,
    reason: result.reason,
    topCandidateCount: result.topN.length
  }, "dispatch_run_finished");

  return result;
}

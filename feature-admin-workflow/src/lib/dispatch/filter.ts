import type { AssignmentStatus, DriverStatus, OrderType } from "@prisma/client";

import { isDriverOnline, isRedisAvailable } from "@/lib/redis";

import { dispatchLog } from "./log";
import { DISPATCHABLE_DRIVER_STATUSES, isDoorOrder, isStoreOrder } from "./rules";
import type { DispatchCandidate, DispatchCoordinate, DriverActiveOrderCounts } from "./types";

/** Maximum straight-line distance (km) for a driver to be considered as a candidate */
const MAX_DISTANCE_KM = 50;

/** Earth's radius in km for Haversine formula */
const EARTH_RADIUS_KM = 6371;

export type DriverForDispatch = {
  id: string;
  name: string;
  phone: string;
  status: DriverStatus;
  storeId: string;
  lastLat: number | null;
  lastLng: number | null;
  store: {
    id: string;
    name: string;
  };
  assignments: Array<{
    status: AssignmentStatus;
    order: {
      type: OrderType;
    };
  }>;
};

/**
 * Haversine formula — calculates the great-circle distance between two points.
 * Returns distance in kilometers.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function countActiveOrders(
  assignments: Array<{
    order: {
      type: OrderType;
    };
  }>
): DriverActiveOrderCounts {
  return assignments.reduce(
    (result, assignment) => {
      if (isStoreOrder(assignment.order.type)) {
        result.store += 1;
      }

      if (isDoorOrder(assignment.order.type)) {
        result.door += 1;
      }

      return result;
    },
    { store: 0, door: 0 }
  );
}

/**
 * Check if a driver has any ACTIVE or ACCEPTED assignment that would conflict
 * with taking a new order.
 */
export function hasActiveAssignment(
  assignments: Array<{
    status: AssignmentStatus;
    order: { type: OrderType };
  }>
): boolean {
  return assignments.some(
    (a) => a.status === "ACTIVE" || a.status === "ACCEPTED"
  );
}

export type FilterInput = {
  orderType: OrderType;
  orderStoreId: string;
  orderLat: number | null;
  orderLng: number | null;
  drivers: DriverForDispatch[];
  originsByDriverId: Map<string, DispatchCoordinate | null>;
};

export type FilterOutput = {
  candidates: DispatchCandidate[];
  skippedReasons: Map<string, string>;
};

/**
 * Pre-screen drivers for dispatch eligibility.
 *
 * Pipeline:
 * 1. Status check (S1-S4 only via DISPATCHABLE_DRIVER_STATUSES)
 * 2. Redis online status check (driver:online:{driverId})
 * 3. Active assignment conflict check
 * 4. Same-store or nearby-store proximity check
 * 5. Haversine distance check (within MAX_DISTANCE_KM)
 * 6. Door-order load check
 *
 * Returns pre-screened candidates and skipped reasons for observability.
 */
export async function filterDispatchCandidates(
  input: FilterInput
): Promise<FilterOutput> {
  const candidates: DispatchCandidate[] = [];
  const skippedReasons = new Map<string, string>();

  for (const driver of input.drivers) {
    const driverId = driver.id;

    // 1. Status check
    if (!DISPATCHABLE_DRIVER_STATUSES.includes(driver.status)) {
      skippedReasons.set(driverId, `status=${driver.status}`);
      continue;
    }

    // 2. Redis online status check
    // Redis 可用时严格检查在线状态；Redis 不可用时跳过在线检查，
    // 依赖步骤 1 的 DB status 过滤，避免因 Redis 降级导致所有司机被排除。
    if (isRedisAvailable()) {
      const online = await isDriverOnline(driverId);
      if (!online) {
        skippedReasons.set(driverId, "not_online_in_redis");
        continue;
      }
    }

    // 3. Active assignment conflict check
    if (hasActiveAssignment(driver.assignments)) {
      skippedReasons.set(driverId, "has_active_assignment");
      continue;
    }

    // 4. Store proximity: same-store always passes; different stores need distance check
    const isSameStore = driver.storeId === input.orderStoreId;

    // 5. Haversine distance check
    const origin = input.originsByDriverId.get(driverId) ?? null;
    let distanceKm = 0;

    if (input.orderLat != null && input.orderLng != null && origin) {
      distanceKm = haversineDistance(
        input.orderLat,
        input.orderLng,
        origin.lat,
        origin.lng
      );
    } else if (
      input.orderLat != null &&
      input.orderLng != null &&
      driver.lastLat != null &&
      driver.lastLng != null
    ) {
      // Fallback: use Driver.lastLat/lastLng if vehicle GPS unavailable
      distanceKm = haversineDistance(
        input.orderLat,
        input.orderLng,
        driver.lastLat,
        driver.lastLng
      );
    }

    if (distanceKm > MAX_DISTANCE_KM) {
      skippedReasons.set(
        driverId,
        `distance_exceeded=${distanceKm.toFixed(1)}km`
      );
      continue;
    }

    // 6. Door-order load check
    const activeOrders = countActiveOrders(driver.assignments);
    if (isDoorOrder(input.orderType) && activeOrders.door >= 1) {
      skippedReasons.set(driverId, "door_order_limit_reached");
      continue;
    }

    candidates.push({
      driverId: driver.id,
      driverName: driver.name,
      phone: driver.phone,
      driverStatus: driver.status,
      storeId: driver.store.id,
      storeName: driver.store.name,
      activeOrders,
      origin,
      distanceKm
    });
  }

  dispatchLog.info("dispatch_filter_result", {
    totalDrivers: String(input.drivers.length),
    candidates: String(candidates.length),
    skipped: String(skippedReasons.size)
  });

  return { candidates, skippedReasons };
}

// Re-export for backward compatibility with tests
export { haversineDistance as _haversineDistance };

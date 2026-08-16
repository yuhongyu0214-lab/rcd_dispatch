import type { Prisma } from "@prisma/client";

import { calculateFreshness } from "@/lib/location/freshness";
import { prisma } from "@/lib/prisma";
import {
  getDriverLocationsWithStatus,
  type DriverLocation
} from "@/lib/redis";

import type {
  AssignmentSummaryV2,
  AssignmentV2,
  DispatchAlertV2,
  DriverLocationV2,
  DriverPlanV2,
  DriverV2,
  ExecutionStatusV2,
  OrderFeasibilityV2,
  OrderV2,
  PageResultV2,
  PlannedAssignmentSlotV2
} from "@/types/v2";

export type PaginationV2 = {
  page: number;
  pageSize: number;
};

export type OrderListFiltersV2 = PaginationV2 & {
  executionStatus?: ExecutionStatusV2;
  feasibility?: OrderFeasibilityV2;
  slot?: "NONE" | PlannedAssignmentSlotV2;
  storeCode?: string;
  keyword?: string;
};

export type MapSnapshotV2 = {
  drivers: DriverV2[];
  orders: OrderV2[];
  openAlertCount: number;
};

export type OrderModificationScalarV2 = string | number | boolean | null;

export type OrderModificationSummaryV2 = {
  id: string;
  operator: { id: string; name: string };
  reason: string | null;
  changes: Array<{
    field: string;
    before: OrderModificationScalarV2;
    after: OrderModificationScalarV2;
  }>;
  traceId: string | null;
  createdAt: string;
};

export type OrderDetailV2 = OrderV2 & {
  currentAssignment?: AssignmentV2;
  alerts: DispatchAlertV2[];
  modificationHistory: OrderModificationSummaryV2[];
};

type OrderRow = Prisma.OrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

type DriverRow = Prisma.DriverGetPayload<{
  select: typeof DRIVER_SELECT;
}>;

type ResolvedLocationSnapshot = {
  location: DriverLocationV2;
  capturedAtMs: number;
};

const ORDER_MODIFICATION_FIELDS = [
  "deliveryAddress",
  "deliveryLat",
  "deliveryLng",
  "pickupAddress",
  "pickupLat",
  "pickupLng",
  "promisedPickupAt"
] as const;

function isJsonRecord(value: unknown): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderModificationScalar(
  value: unknown
): value is OrderModificationScalarV2 {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function mapOrderModificationChanges(
  metadataJson: Prisma.JsonValue | null
): OrderModificationSummaryV2["changes"] {
  if (!isJsonRecord(metadataJson)) return [];
  const before = metadataJson.before;
  const after = metadataJson.after;
  if (!isJsonRecord(before) || !isJsonRecord(after)) return [];

  return ORDER_MODIFICATION_FIELDS
    .filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(before, field) &&
        Object.prototype.hasOwnProperty.call(after, field)
    )
    .flatMap((field) => {
      const beforeValue = before[field];
      const afterValue = after[field];
      if (
        !isOrderModificationScalar(beforeValue) ||
        !isOrderModificationScalar(afterValue) ||
        Object.is(beforeValue, afterValue)
      ) {
        return [];
      }
      return [{ field, before: beforeValue, after: afterValue }];
    });
}

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  sourceSystem: true,
  externalOrderId: true,
  sourceVersion: true,
  type: true,
  executionStatus: true,
  feasibility: true,
  slackMinutes: true,
  promisedPickupAt: true,
  receivedAt: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  deliveryAddress: true,
  deliveryLat: true,
  deliveryLng: true,
  licensePlateSnapshot: true,
  vehicleTypeSnapshot: true,
  remark: true,
  cancelledAt: true,
  currentAssignmentId: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { code: true, name: true } }
} satisfies Prisma.OrderSelect;

const ASSIGNMENT_SELECT = {
  id: true,
  orderId: true,
  driverId: true,
  sequenceNo: true,
  lockType: true,
  plannedDepartAt: true,
  plannedPickupAt: true,
  plannedCompleteAt: true,
  deadheadEtaMinutes: true,
  serviceEtaMinutes: true,
  etaUnavailableReason: true,
  departedAt: true,
  arrivedAt: true,
  completedAt: true,
  lastEtaCalculatedAt: true
} satisfies Prisma.AssignmentSelect;

const DRIVER_SELECT = {
  id: true,
  name: true,
  onShift: true,
  availability: true,
  planVersion: true,
  lastLat: true,
  lastLng: true,
  lastAccuracyMeters: true,
  lastLocationCapturedAt: true,
  store: { select: { code: true } },
  shifts: {
    where: { endedAt: null },
    orderBy: { startedAt: "desc" },
    take: 1,
    select: { startedAt: true }
  },
  assignments: {
    where: {
      status: { in: ["ACTIVE", "ACCEPTED"] },
      order: { executionStatus: { notIn: ["COMPLETED", "CANCELLED"] } }
    },
    orderBy: { sequenceNo: "asc" },
    select: {
      ...ASSIGNMENT_SELECT,
      order: {
        select: {
          orderNo: true,
          executionStatus: true
        }
      }
    }
  }
} satisfies Prisma.DriverSelect;

const ETA_UNAVAILABLE_REASONS = new Set([
  "AMAP_UNAVAILABLE",
  "ORIGIN_MISSING",
  "DESTINATION_MISSING",
  "LOCATION_STALE"
]);

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

function mapOrder(row: OrderRow): OrderV2 {
  return {
    id: row.id,
    orderNo: row.orderNo,
    sourceSystem: row.sourceSystem,
    externalOrderId: row.externalOrderId,
    sourceVersion: row.sourceVersion,
    businessType: row.type,
    executionStatus: row.executionStatus,
    feasibility: row.feasibility,
    slackMinutes: row.slackMinutes,
    promisedPickupAt: row.promisedPickupAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    pickupAddress: row.pickupAddress,
    pickupLat: optional(row.pickupLat),
    pickupLng: optional(row.pickupLng),
    deliveryAddress: row.deliveryAddress,
    deliveryLat: optional(row.deliveryLat),
    deliveryLng: optional(row.deliveryLng),
    storeCode: row.store.code,
    storeName: row.store.name,
    licensePlateSnapshot: optional(row.licensePlateSnapshot),
    vehicleTypeSnapshot: optional(row.vehicleTypeSnapshot),
    remark: optional(row.remark),
    cancelledAt: row.cancelledAt?.toISOString(),
    currentAssignmentId: optional(row.currentAssignmentId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function slotForSequence(sequenceNo: number | null): "NONE" | PlannedAssignmentSlotV2 {
  if (sequenceNo === null) return "NONE";
  if (sequenceNo === 1) return "A";
  if (sequenceNo === 2) return "B";
  if (sequenceNo === 3) return "C";
  throw new Error(`Invalid assignment sequenceNo: ${sequenceNo}`);
}

function mapAssignment(
  row: Prisma.AssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>
): AssignmentV2 {
  const etaUnavailableReason = row.etaUnavailableReason;
  const eta =
    etaUnavailableReason && ETA_UNAVAILABLE_REASONS.has(etaUnavailableReason)
      ? {
          etaAvailable: false as const,
          etaUnavailableReason: etaUnavailableReason as
            | "AMAP_UNAVAILABLE"
            | "ORIGIN_MISSING"
            | "DESTINATION_MISSING"
            | "LOCATION_STALE"
        }
      : { etaAvailable: true as const };

  return {
    id: row.id,
    orderId: row.orderId,
    driverId: row.driverId,
    sequenceNo:
      row.sequenceNo === 1 || row.sequenceNo === 2 || row.sequenceNo === 3
        ? row.sequenceNo
        : undefined,
    slot: slotForSequence(row.sequenceNo),
    lockType: row.lockType,
    plannedDepartAt: row.plannedDepartAt?.toISOString(),
    plannedPickupAt: row.plannedPickupAt?.toISOString(),
    plannedCompleteAt: row.plannedCompleteAt?.toISOString(),
    deadheadEtaMinutes: optional(row.deadheadEtaMinutes),
    serviceEtaMinutes: optional(row.serviceEtaMinutes),
    departedAt: row.departedAt?.toISOString(),
    arrivedAt: row.arrivedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    lastEtaCalculatedAt: row.lastEtaCalculatedAt?.toISOString(),
    ...eta
  };
}

function mapAssignmentSummary(
  row: DriverRow["assignments"][number]
): AssignmentSummaryV2 {
  const slot = slotForSequence(row.sequenceNo);
  if (slot === "NONE") {
    throw new Error(`Effective assignment ${row.id} has no plan slot`);
  }
  return {
    id: row.id,
    orderId: row.orderId,
    orderNo: row.order.orderNo,
    executionStatus: row.order.executionStatus,
    slot,
    lockType: row.lockType,
    plannedPickupAt: row.plannedPickupAt?.toISOString(),
    plannedCompleteAt: row.plannedCompleteAt?.toISOString()
  };
}

function resolveRedisSnapshot(
  location: DriverLocation | null
): ResolvedLocationSnapshot | null {
  if (
    !location ||
    !location.lat ||
    !location.lng ||
    !location.accuracy ||
    !location.ts
  ) {
    return null;
  }
  const lat = Number.parseFloat(location.lat);
  const lng = Number.parseFloat(location.lng);
  const accuracyMeters = Number.parseFloat(location.accuracy);
  const capturedAtMs = Date.parse(location.ts);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracyMeters) ||
    !Number.isFinite(capturedAtMs)
  ) {
    return null;
  }
  return {
    location: { lat, lng, accuracyMeters, capturedAt: location.ts },
    capturedAtMs
  };
}

function resolveDbSnapshot(row: DriverRow): ResolvedLocationSnapshot | null {
  if (
    row.lastLat === null ||
    row.lastLng === null ||
    row.lastAccuracyMeters === null ||
    row.lastLocationCapturedAt === null
  ) {
    return null;
  }
  if (
    !Number.isFinite(row.lastLat) ||
    !Number.isFinite(row.lastLng) ||
    !Number.isFinite(row.lastAccuracyMeters) ||
    !Number.isFinite(row.lastLocationCapturedAt.getTime())
  ) {
    return null;
  }
  return {
    location: {
      lat: row.lastLat,
      lng: row.lastLng,
      accuracyMeters: row.lastAccuracyMeters,
      capturedAt: row.lastLocationCapturedAt.toISOString()
    },
    capturedAtMs: row.lastLocationCapturedAt.getTime()
  };
}

async function mapDrivers(rows: DriverRow[]): Promise<DriverV2[]> {
  const redisBatch = await getDriverLocationsWithStatus(rows.map((row) => row.id));
  const nowMs = Date.now();

  return rows.map((row) => {
    const redisSnapshot = redisBatch.redisAvailable
      ? resolveRedisSnapshot(redisBatch.locations.get(row.id) ?? null)
      : null;
    const dbSnapshot = resolveDbSnapshot(row);
    const snapshot =
      !redisSnapshot ||
      (dbSnapshot && dbSnapshot.capturedAtMs > redisSnapshot.capturedAtMs)
        ? dbSnapshot
        : redisSnapshot;
    const slots: DriverV2["slots"] = {};
    for (const assignment of row.assignments) {
      const summary = mapAssignmentSummary(assignment);
      slots[summary.slot] = summary;
    }

    return {
      id: row.id,
      name: row.name,
      storeCode: row.store.code,
      onShift: row.onShift,
      shiftStartedAt: row.shifts[0]?.startedAt.toISOString(),
      availability: row.availability,
      planVersion: row.planVersion,
      locationFreshness: snapshot
        ? calculateFreshness(snapshot.location.capturedAt, nowMs).freshness
        : row.lastLocationCapturedAt
          ? calculateFreshness(row.lastLocationCapturedAt.toISOString(), nowMs)
              .freshness
          : "NONE",
      lastLocation: snapshot?.location,
      slots
    };
  });
}

export async function getMapSnapshot(): Promise<MapSnapshotV2> {
  const [driverRows, orderRows, openAlertCount] = await Promise.all([
    prisma.driver.findMany({
      where: { onShift: true, isActive: true },
      select: DRIVER_SELECT,
      orderBy: { id: "asc" }
    }),
    prisma.order.findMany({
      select: ORDER_SELECT,
      orderBy: [{ promisedPickupAt: "asc" }, { id: "asc" }]
    }),
    prisma.dispatchAlert.count({ where: { status: "OPEN" } })
  ]);

  return {
    drivers: await mapDrivers(driverRows),
    orders: orderRows.map(mapOrder),
    openAlertCount
  };
}

export async function listOrders(
  filters: OrderListFiltersV2
): Promise<PageResultV2<OrderV2>> {
  const where: Prisma.OrderWhereInput = {
    executionStatus: filters.executionStatus,
    feasibility: filters.feasibility,
    store: filters.storeCode ? { code: filters.storeCode } : undefined,
    currentAssignment:
      filters.slot === "NONE"
        ? null
        : filters.slot
          ? { sequenceNo: { A: 1, B: 2, C: 3 }[filters.slot] }
          : undefined,
    OR: filters.keyword
      ? [
          { orderNo: { contains: filters.keyword, mode: "insensitive" } },
          { externalOrderId: { contains: filters.keyword, mode: "insensitive" } },
          { pickupAddress: { contains: filters.keyword, mode: "insensitive" } },
          { deliveryAddress: { contains: filters.keyword, mode: "insensitive" } }
        ]
      : undefined
  };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: [{ promisedPickupAt: "asc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize
    })
  ]);
  return {
    items: rows.map(mapOrder),
    total,
    page: filters.page,
    pageSize: filters.pageSize
  };
}

export async function getOrderDetail(
  orderId: string
): Promise<OrderDetailV2 | null> {
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      ...ORDER_SELECT,
      currentAssignment: { select: ASSIGNMENT_SELECT },
      dispatchAlerts: { orderBy: { createdAt: "desc" } },
      operationLogs: {
        where: { action: "ORDER_MODIFY" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reason: true,
          traceId: true,
          metadataJson: true,
          createdAt: true,
          operatorUser: { select: { id: true, name: true } }
        }
      }
    }
  });
  if (!row) return null;

  return {
    ...mapOrder(row),
    currentAssignment: row.currentAssignment
      ? mapAssignment(row.currentAssignment)
      : undefined,
    alerts: row.dispatchAlerts.map((alert) => ({
      id: alert.id,
      orderId: alert.orderId,
      type: alert.type,
      status: alert.status,
      slackMinutesAtCreate: alert.slackMinutesAtCreate,
      createdAt: alert.createdAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      resolvedBy: alert.resolvedBy ?? undefined,
      historyRetained: true
    })),
    modificationHistory: row.operationLogs.map((entry) => ({
      id: entry.id,
      operator: entry.operatorUser,
      reason: entry.reason,
      changes: mapOrderModificationChanges(entry.metadataJson),
      traceId: entry.traceId,
      createdAt: entry.createdAt.toISOString()
    }))
  };
}

export async function listDrivers(
  pagination: PaginationV2
): Promise<PageResultV2<DriverV2>> {
  const where: Prisma.DriverWhereInput = { isActive: true };
  const [total, rows] = await Promise.all([
    prisma.driver.count({ where }),
    prisma.driver.findMany({
      where,
      select: DRIVER_SELECT,
      orderBy: { id: "asc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize
    })
  ]);
  return {
    items: await mapDrivers(rows),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
}

export async function getDriverPlan(
  driverId: string
): Promise<DriverPlanV2 | null> {
  const row = await prisma.driver.findFirst({
    where: { id: driverId, isActive: true },
    select: DRIVER_SELECT
  });
  if (!row) return null;
  const [driver] = await mapDrivers([row]);
  return {
    id: driver.id,
    name: driver.name,
    planVersion: driver.planVersion,
    locationFreshness: driver.locationFreshness,
    lastLocation: driver.lastLocation,
    slots: driver.slots
  };
}

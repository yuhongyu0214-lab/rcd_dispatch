import type { OrderExecutionStatus } from "@prisma/client";

import type {
  AssignmentLockTypeV2,
  DriverAvailabilityV2,
  ExecutionStatusV2,
  IsoDateTimeStringV2,
  LocationFreshnessV2,
  OrderFeasibilityV2,
  PlanSequenceV2,
} from "@/types/v2";
import type {
  DispatchDriverInputV2,
  DispatchEventV2,
  DispatchInputV2,
  DispatchOrderInputV2,
  DispatchAssignmentInputV2,
} from "@/types/v2/dispatch";

import {
  findDispatchableOrders,
  findDispatchableDrivers,
  findEffectiveAssignments,
  findServicePlans,
} from "../repositories";
import type {
  DispatchableOrderRow,
  DispatchableDriverRow,
  EffectiveAssignmentRow,
} from "../repositories";

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Orders excluded from the planning pool per Gate 3 ruling. */
const EXCLUDED_EXECUTION_STATUSES: ReadonlySet<OrderExecutionStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
]);

/** Assignments that are ALWAYS immobile regardless of execution status. */
function isLockedImmobile(lockType: string): boolean {
  return lockType === "MANUAL_LOCKED" || lockType === "AUTO_FROZEN";
}

/** Execution statuses that make an unlocked assignment immobile. */
function isExecutionImmobile(executionStatus: OrderExecutionStatus): boolean {
  return executionStatus === "EN_ROUTE" || executionStatus === "IN_SERVICE";
}

function toIso(d: Date): IsoDateTimeStringV2 {
  return d.toISOString();
}

function toExecutionStatusV2(s: OrderExecutionStatus): ExecutionStatusV2 {
  // Prisma enum values match V2 string unions — direct cast safe.
  return s as unknown as ExecutionStatusV2;
}

function toFeasibilityV2(f: string): OrderFeasibilityV2 {
  return f as OrderFeasibilityV2;
}

function toAvailabilityV2(a: string): DriverAvailabilityV2 {
  return a as DriverAvailabilityV2;
}

function toLockTypeV2(lt: string): AssignmentLockTypeV2 {
  return lt as AssignmentLockTypeV2;
}

function toPlanSequence(seqNo: number | null): PlanSequenceV2 {
  // Cast safe because DB only stores 1|2|3 for active assignments.
  return (seqNo ?? 1) as PlanSequenceV2;
}

function locationFreshness(
  capturedAt: Date | null
): LocationFreshnessV2 {
  if (!capturedAt) return "NONE";
  const ageMs = Date.now() - capturedAt.getTime();
  // Stale threshold: 5 minutes (matches 1B Redis TTL window).
  return ageMs < 300_000 ? "FRESH" : "STALE";
}

function mapOrder(row: DispatchableOrderRow, serviceModuleMinutes: number): DispatchOrderInputV2 {
  return {
    orderId: row.id,
    orderNo: row.orderNo,
    businessType: row.type as DispatchOrderInputV2["businessType"],
    executionStatus: toExecutionStatusV2(row.executionStatus),
    feasibility: toFeasibilityV2(row.feasibility),
    slackMinutes: row.slackMinutes,
    promisedPickupAt: toIso(row.promisedPickupAt),
    pickupAddress: row.pickupAddress,
    pickupLocation:
      row.pickupLat != null && row.pickupLng != null
        ? { lat: row.pickupLat, lng: row.pickupLng }
        : undefined,
    deliveryAddress: row.deliveryAddress,
    deliveryLocation:
      row.deliveryLat != null && row.deliveryLng != null
        ? { lat: row.deliveryLat, lng: row.deliveryLng }
        : undefined,
    storeCode: row.storeCode,
    currentAssignmentId: row.currentAssignmentId ?? undefined,
    serviceModuleMinutes,
  };
}

function mapAssignment(row: EffectiveAssignmentRow): DispatchAssignmentInputV2 {
  return {
    assignmentId: row.id,
    orderId: row.orderId,
    sequenceNo: toPlanSequence(row.sequenceNo),
    lockType: toLockTypeV2(row.lockType),
    executionStatus: toExecutionStatusV2(row.orderExecutionStatus),
    pickupLocation:
      row.pickupLat != null && row.pickupLng != null
        ? { lat: row.pickupLat, lng: row.pickupLng }
        : undefined,
    deliveryLocation:
      row.deliveryLat != null && row.deliveryLng != null
        ? { lat: row.deliveryLat, lng: row.deliveryLng }
        : undefined,
    plannedDepartAt: row.plannedDepartAt ? toIso(row.plannedDepartAt) : undefined,
    plannedCompleteAt: row.plannedCompleteAt ? toIso(row.plannedCompleteAt) : undefined,
    serviceModuleMinutes: 0, // filled later from plan map
  };
}

function mapDriver(
  row: DispatchableDriverRow,
  assignments: DispatchAssignmentInputV2[]
): DispatchDriverInputV2 {
  return {
    driverId: row.id,
    storeCode: row.storeCode,
    onShift: row.onShift,
    availability: toAvailabilityV2(row.availability),
    planVersion: row.planVersion,
    locationFreshness: locationFreshness(row.lastLocationCapturedAt),
    lastLocation:
      row.lastLat != null && row.lastLng != null
        ? {
            lat: row.lastLat,
            lng: row.lastLng,
            accuracyMeters: row.lastAccuracyMeters ?? 0,
            capturedAt: row.lastLocationCapturedAt
              ? toIso(row.lastLocationCapturedAt)
              : toIso(new Date(0)),
          }
        : undefined,
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Affected-scope resolution
// ---------------------------------------------------------------------------

type AffectedScope = {
  storeIds: string[];
  orderIds: string[];
  driverIds: string[];
};

async function resolveAffectedScope(
  event: DispatchEventV2
): Promise<AffectedScope> {
  const { type, orderId, driverId, assignmentId } = event;

  // BASELINE_RECALCULATION → all active stores.
  if (type === "BASELINE_RECALCULATION") {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return {
      storeIds: stores.map((s) => s.id),
      orderIds: [],
      driverIds: [],
    };
  }

  const storeIds = new Set<string>();

  // Resolve store from orderId
  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { storeId: true },
    });
    if (order) storeIds.add(order.storeId);
  }

  // Resolve store from driverId
  if (driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { storeId: true },
    });
    if (driver) storeIds.add(driver.storeId);
  }

  // Resolve stores from assignmentId (order's store + driver's store)
  if (assignmentId) {
    const asg = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        order: { select: { storeId: true } },
        driver: { select: { storeId: true } },
      },
    });
    if (asg) {
      storeIds.add(asg.order.storeId);
      storeIds.add(asg.driver.storeId);
    }
  }

  return {
    storeIds: [...storeIds],
    orderIds: orderId ? [orderId] : [],
    driverIds: driverId ? [driverId] : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a read-only dispatch input snapshot from the database.
 *
 * This is a pure read operation — it produces a `DispatchInputV2` from the
 * current database state without any side effects.
 *
 * Rules enforced:
 *   - COMPLETED / CANCELLED orders are excluded from the planning pool.
 *   - EN_ROUTE / IN_SERVICE / MANUAL_LOCKED / AUTO_FROZEN assignments enter
 *     the snapshot as protected (immobile) assignments.
 *   - All queries are batched per store/driver scope — no N+1.
 *
 * @returns A complete `DispatchInputV2` ready for the pure computation core.
 */
export async function buildDispatchSnapshot(
  event: DispatchEventV2
): Promise<DispatchInputV2> {
  // 1. Resolve affected stores
  const scope = await resolveAffectedScope(event);

  // 2. Batch-read orders (COMPLETED/CANCELLED excluded at DB level)
  const orderRows = await findDispatchableOrders({
    storeIds: scope.storeIds,
    orderIds: scope.orderIds.length > 0 ? scope.orderIds : undefined,
  });

  // 3. Batch-read drivers
  const driverRows = await findDispatchableDrivers({
    storeIds: scope.storeIds,
    driverIds: scope.driverIds.length > 0 ? scope.driverIds : undefined,
  });

  const driverIdList = driverRows.map((d) => d.id);

  // 4. Batch-read effective assignments for all affected drivers
  const assignmentRows = await findEffectiveAssignments({
    driverIds: driverIdList,
    orderIds: scope.orderIds.length > 0 ? scope.orderIds : undefined,
  });

  // 5. Batch-read service plans for all effective assignments
  const assignmentIdList = assignmentRows.map((a) => a.id);
  const planRows = await findServicePlans({ assignmentIds: assignmentIdList });
  const planMap = new Map<string, number>();
  for (const p of planRows) {
    planMap.set(p.assignmentId, p.totalModuleMinutes);
  }

  // 6. Build per-driver assignment lists AND per-order module-minute totals
  //    in a single pass over assignmentRows (no N+1, no find() lookups).
  const driverAsgMap = new Map<string, DispatchAssignmentInputV2[]>();
  const orderModuleMap = new Map<string, number>();

  for (const row of assignmentRows) {
    const mins = planMap.get(row.id) ?? 0;

    // Per-driver assignment input
    const input = mapAssignment(row);
    input.serviceModuleMinutes = mins;
    const list = driverAsgMap.get(row.driverId) ?? [];
    list.push(input);
    driverAsgMap.set(row.driverId, list);

    // Per-order module minute accumulation
    orderModuleMap.set(row.orderId, (orderModuleMap.get(row.orderId) ?? 0) + mins);
  }

  // 7. Map orders → DispatchOrderInputV2
  const orders: DispatchOrderInputV2[] = orderRows.map((r) =>
    mapOrder(r, orderModuleMap.get(r.id) ?? 0)
  );

  // 8. Map drivers → DispatchDriverInputV2
  const drivers: DispatchDriverInputV2[] = driverRows.map((row) =>
    mapDriver(row, driverAsgMap.get(row.id) ?? [])
  );

  return { event, orders, drivers };
}

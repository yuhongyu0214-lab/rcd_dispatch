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
// Frozen constants — data architecture §7.1 rule 5
// ---------------------------------------------------------------------------

/** Location freshness threshold: 120 seconds from capture time. */
const FRESH_THRESHOLD_MS = 120_000;

/** Valid plan sequence numbers. */
const VALID_SEQUENCE_NOS: ReadonlySet<number> = new Set([1, 2, 3]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function toIso(d: Date): IsoDateTimeStringV2 {
  return d.toISOString();
}

function toExecutionStatusV2(s: string): ExecutionStatusV2 {
  return s as ExecutionStatusV2;
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

/**
 * Validate and cast a DB sequenceNo to a PlanSequenceV2.
 *
 * Null or out-of-range values throw — the snapshot must not guess a slot
 * for malformed effective assignments.
 */
function requirePlanSequence(seqNo: number | null): PlanSequenceV2 {
  if (seqNo === null || !VALID_SEQUENCE_NOS.has(seqNo)) {
    throw new Error(
      `Invalid assignment sequenceNo: ${seqNo} — expected 1, 2, or 3`
    );
  }
  return seqNo as PlanSequenceV2;
}

/**
 * Compute location freshness from a DB capturedAt timestamp.
 *
 * Frozen rule (data architecture §7.1 rule 5):
 * - Age ≤ 120 s → FRESH
 * - Age > 120 s → STALE
 * - null capturedAt → NONE
 */
function locationFreshness(
  capturedAt: Date | null,
  nowMs: number
): LocationFreshnessV2 {
  if (!capturedAt) return "NONE";
  const ageMs = nowMs - capturedAt.getTime();
  return ageMs <= FRESH_THRESHOLD_MS ? "FRESH" : "STALE";
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapOrder(
  row: DispatchableOrderRow,
  serviceModuleMinutes: number
): DispatchOrderInputV2 {
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

function mapAssignment(
  row: EffectiveAssignmentRow
): DispatchAssignmentInputV2 {
  return {
    assignmentId: row.id,
    orderId: row.orderId,
    sequenceNo: requirePlanSequence(row.sequenceNo),
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
    plannedDepartAt: row.plannedDepartAt
      ? toIso(row.plannedDepartAt)
      : undefined,
    plannedCompleteAt: row.plannedCompleteAt
      ? toIso(row.plannedCompleteAt)
      : undefined,
    serviceModuleMinutes: 0, // filled later from plan map
  };
}

/**
 * Build a driver's location payload.
 *
 * Frozen rule: if ANY of lat / lng / accuracyMeters / capturedAt is null,
 * `lastLocation` is omitted entirely. No field-level defaults are invented.
 */
function mapDriverLocation(row: DispatchableDriverRow) {
  if (
    row.lastLat === null ||
    row.lastLng === null ||
    row.lastAccuracyMeters === null ||
    row.lastLocationCapturedAt === null
  ) {
    return undefined;
  }
  return {
    lat: row.lastLat,
    lng: row.lastLng,
    accuracyMeters: row.lastAccuracyMeters,
    capturedAt: toIso(row.lastLocationCapturedAt),
  };
}

function mapDriver(
  row: DispatchableDriverRow,
  assignments: DispatchAssignmentInputV2[],
  nowMs: number
): DispatchDriverInputV2 {
  return {
    driverId: row.id,
    storeCode: row.storeCode,
    onShift: row.onShift,
    availability: toAvailabilityV2(row.availability),
    planVersion: row.planVersion,
    locationFreshness: locationFreshness(row.lastLocationCapturedAt, nowMs),
    lastLocation: mapDriverLocation(row),
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Affected-scope resolution
// ---------------------------------------------------------------------------

type AffectedScope = {
  storeIds: string[];
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
    return { storeIds: stores.map((s) => s.id) };
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

  return { storeIds: [...storeIds] };
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
 * Frozen rules:
 * - COMPLETED / CANCELLED orders excluded at DB query level.
 * - Orders: ALL dispatchable orders in the affected stores PLUS any order
 *   referenced by a loaded assignment (even when the order belongs to a
 *   different store — cross-store assignments are legitimate in V1).
 * - A driver that enters the snapshot brings ALL of its effective assignments.
 *   The assignment query MUST NOT filter by a single orderId — otherwise
 *   new-order events would see empty timelines and overwrite locked slots.
 * - Location: all four fields (lat / lng / accuracy / capturedAt) must be
 *   non-null; any null → lastLocation omitted entirely.
 * - Location freshness: ≤ 120 s → FRESH, > 120 s → STALE, null → NONE.
 * - sequenceNo: null or out of 1–3 range → hard throw (corrupt data must
 *   not be silently patched).
 * - All queries batched per store/driver scope — zero N+1.
 */
export async function buildDispatchSnapshot(
  event: DispatchEventV2
): Promise<DispatchInputV2> {
  const nowMs = Date.now();

  // 1. Resolve affected stores
  const scope = await resolveAffectedScope(event);

  // 2. Batch-read drivers in affected stores
  const driverRows = await findDispatchableDrivers({
    storeIds: scope.storeIds,
  });

  const driverIdList = driverRows.map((d) => d.id);

  // 3. Batch-read ALL effective assignments for every driver in scope.
  //    NEVER filter by a single orderId — stripping other orders'
  //    assignments from candidate drivers would make the core think their
  //    A/B/C slots are empty.
  const assignmentRows = await findEffectiveAssignments({
    driverIds: driverIdList,
  });

  // 4. Collect order IDs referenced by assignments. These may include
  //    cross-store orders that would be missed by the store-only filter.
  //    Pass them as requiredOrderIds (UNION, not intersection) so every
  //    order referenced by a loaded assignment is guaranteed present.
  const requiredOrderIds = assignmentRows.length > 0
    ? [...new Set(assignmentRows.map((a) => a.orderId))]
    : undefined;

  // 5. Batch-read orders: affected stores ∪ assignment-referenced orders
  const orderRows = await findDispatchableOrders({
    storeIds: scope.storeIds,
    requiredOrderIds,
  });

  // 6. Batch-read service plans for all effective assignments
  const assignmentIdList = assignmentRows.map((a) => a.id);
  const planRows = await findServicePlans({
    assignmentIds: assignmentIdList,
  });
  const planMap = new Map<string, number>();
  for (const p of planRows) {
    planMap.set(p.assignmentId, p.totalModuleMinutes);
  }

  // 7. Build per-driver assignment lists AND per-order module-minute totals
  //    in a single pass (no N+1, no find() lookups).
  const driverAsgMap = new Map<string, DispatchAssignmentInputV2[]>();
  const orderModuleMap = new Map<string, number>();

  for (const row of assignmentRows) {
    const mins = planMap.get(row.id) ?? 0;

    const input = mapAssignment(row);
    input.serviceModuleMinutes = mins;
    const list = driverAsgMap.get(row.driverId) ?? [];
    list.push(input);
    driverAsgMap.set(row.driverId, list);

    orderModuleMap.set(
      row.orderId,
      (orderModuleMap.get(row.orderId) ?? 0) + mins
    );
  }

  // 8. Map orders → DispatchOrderInputV2
  const orders: DispatchOrderInputV2[] = orderRows.map((r) =>
    mapOrder(r, orderModuleMap.get(r.id) ?? 0)
  );

  // 9. Map drivers → DispatchDriverInputV2
  const drivers: DispatchDriverInputV2[] = driverRows.map((row) =>
    mapDriver(row, driverAsgMap.get(row.id) ?? [], nowMs)
  );

  return { event, orders, drivers };
}

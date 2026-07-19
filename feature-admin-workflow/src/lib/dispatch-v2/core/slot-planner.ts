import type {
  DispatchAssignmentInputV2,
  DispatchDriverInputV2,
  DispatchOrderInputV2,
  DispatchPlannedAssignmentV2 as PlannedAssignment,
  EtaUnavailableReasonV2,
  ExecutionStatusV2,
  GeoPointV2,
  IsoDateTimeStringV2,
  PlanSequenceV2,
  PlannedAssignmentSlotV2,
} from "@/types/v2";

import { filterDispatchableOrders } from "./candidate-filter";
import { etaUnavailableReason } from "./feasibility";
import type { DriverCursor, EtaResolver } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addMinutes(iso: IsoDateTimeStringV2, minutes: number): IsoDateTimeStringV2 {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function minutesBetween(earlier: IsoDateTimeStringV2, later: IsoDateTimeStringV2): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 60000;
}

function isAfter(a: IsoDateTimeStringV2, b: IsoDateTimeStringV2): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

const SEQ_TO_SLOT: Record<PlanSequenceV2, PlannedAssignmentSlotV2> = {
  1: "A",
  2: "B",
  3: "C",
};

/**
 * Terminal execution states — assignments in these states are discarded
 * outright: they occupy no slot, advance no cursor, and their orders never
 * (re-)enter the dispatchable pool.
 */
const TERMINAL_ASSIGNMENT_STATUSES: ReadonlySet<ExecutionStatusV2> = new Set([
  "COMPLETED",
  "CANCELLED",
]);

/**
 * Is an assignment immobile — i.e. must NOT be released or moved during
 * this planning run?
 *
 * Immobile when:
 *   - lockType = AUTO_FROZEN or MANUAL_LOCKED, OR
 *   - the assignment's OWN executionStatus is EN_ROUTE / IN_SERVICE
 *     (authoritative — protects execution even when the order snapshot
 *     is missing or inconsistent with assignment reality), OR
 *   - the associated order's executionStatus is EN_ROUTE or IN_SERVICE
 *     (fallback for backward compatibility)
 *
 * COMPLETED / CANCELLED assignments are discarded before this check
 * (see TERMINAL_ASSIGNMENT_STATUSES) — they must never reach here.
 */
function isImmobile(
  assignment: DispatchAssignmentInputV2,
  orderMap: Map<string, DispatchOrderInputV2>
): boolean {
  if (assignment.lockType === "AUTO_FROZEN" || assignment.lockType === "MANUAL_LOCKED") {
    return true;
  }
  if (
    assignment.executionStatus === "EN_ROUTE" ||
    assignment.executionStatus === "IN_SERVICE"
  ) {
    return true;
  }
  const order = orderMap.get(assignment.orderId);
  return order != null && (order.executionStatus === "EN_ROUTE" || order.executionStatus === "IN_SERVICE");
}

// ---------------------------------------------------------------------------
// Cursor advancement
// ---------------------------------------------------------------------------

/**
 * Advance a driver's timeline cursor past a single (mobile) assignment,
 * recomputing travel times via the injected resolver.
 *
 * Returns a new cursor (never mutates the input) that represents the
 * driver's state AFTER completing this assignment.
 */
function advanceCursor(
  cursor: DriverCursor,
  assignment: DispatchAssignmentInputV2,
  etaResolver: EtaResolver
): DriverCursor {
  const pickup : GeoPointV2 | undefined = assignment.pickupLocation;
  const delivery: GeoPointV2 | undefined = assignment.deliveryLocation;

  let nextPos: GeoPointV2 | null = delivery ?? null;
  let nextAvailable: IsoDateTimeStringV2 | null = cursor.availableAt;
  let nextEtaAvailable = cursor.etaAvailable;

  if (cursor.position && pickup && cursor.availableAt != null) {
    const deadhead = etaResolver(cursor.position, pickup);
    if (deadhead != null) {
      const pickupAt = addMinutes(cursor.availableAt, deadhead);
      if (pickup && delivery) {
        const service = etaResolver(pickup, delivery);
        if (service != null) {
          // Use existing plannedComplete if present, else compute
          nextAvailable = assignment.plannedCompleteAt ??
            addMinutes(pickupAt, service + assignment.serviceModuleMinutes);
        } else {
          nextEtaAvailable = false;
        }
      } else {
        nextEtaAvailable = false;
      }
    } else {
      nextEtaAvailable = false;
    }
  } else {
    nextEtaAvailable = false;
    nextAvailable = cursor.availableAt;
  }

  // If service ETA was unavailable but plannedCompleteAt is known, use it
  if (assignment.plannedCompleteAt && nextEtaAvailable === false) {
    nextAvailable = assignment.plannedCompleteAt;
  }

  return { position: nextPos, availableAt: nextAvailable, etaAvailable: nextEtaAvailable };
}

/**
 * Advance the cursor past an IMMOBILE assignment using ONLY its stored plan:
 * locked / executing assignments keep the plan they were locked with — their
 * times must never drift with the event time, the driver's current position,
 * or the injected ETA resolver.
 *
 * Frozen rule:
 *   - availableAt := stored `plannedCompleteAt`. When missing, the cursor
 *     time becomes UNKNOWN (null) — subsequent slots for this driver cannot
 *     be planned, and the missing time is NEVER recomputed via the resolver.
 *   - position := stored `deliveryLocation`. When missing, the position is
 *     unknown (null) — no deadhead may be derived from a stale position.
 */
function advanceCursorForImmobile(
  assignment: DispatchAssignmentInputV2
): DriverCursor {
  const position = assignment.deliveryLocation ?? null;
  const availableAt = assignment.plannedCompleteAt ?? null;
  return {
    position,
    availableAt,
    etaAvailable: position != null && availableAt != null,
  };
}

// ---------------------------------------------------------------------------
// Build a PlannedAssignment for a specific slot
// ---------------------------------------------------------------------------

function buildPlannedAssignment(
  assignment: DispatchAssignmentInputV2,
  cursor: DriverCursor,
  etaResolver: EtaResolver,
  immobile: boolean
): PlannedAssignment {
  // Immobile assignments echo their stored plan VERBATIM — the planned times
  // of locked / executing assignments are never recalculated from the event
  // time / current position, and missing stored times are never reconstructed.
  // (The input contract no longer carries a pickup time, so none is emitted.)
  if (immobile) {
    const base = {
      assignmentId: assignment.assignmentId,
      orderId: assignment.orderId,
      sequenceNo: assignment.sequenceNo,
      slot: SEQ_TO_SLOT[assignment.sequenceNo],
      plannedDepartAt: assignment.plannedDepartAt,
      plannedCompleteAt: assignment.plannedCompleteAt,
    };
    if (assignment.plannedDepartAt != null && assignment.plannedCompleteAt != null) {
      return { ...base, etaAvailable: true };
    }
    // Stored plan is incomplete — surface the data gap instead of computing
    // replacement times (generic reason: the plan chain cannot be resolved).
    return { ...base, etaAvailable: false, etaUnavailableReason: "AMAP_UNAVAILABLE" };
  }

  const pickup = assignment.pickupLocation;
  const delivery = assignment.deliveryLocation;

  const hasOrigin =
    cursor.position != null && cursor.etaAvailable && cursor.availableAt != null;
  const hasDest = pickup != null;
  const hasDelivery = delivery != null;

  let deadheadMinutes: number | undefined;
  let serviceMinutes: number | undefined;
  let departAt: IsoDateTimeStringV2 | undefined;
  let pickupAt: IsoDateTimeStringV2 | undefined;
  let completeAt: IsoDateTimeStringV2 | undefined;

  if (hasOrigin && hasDest && cursor.position && pickup && cursor.availableAt != null) {
    const deadhead = etaResolver(cursor.position, pickup);
    if (deadhead != null) {
      deadheadMinutes = deadhead;
      departAt = cursor.availableAt;
      pickupAt = addMinutes(cursor.availableAt, deadhead);

      if (hasDelivery && delivery) {
        const service = etaResolver(pickup, delivery);
        if (service != null) {
          serviceMinutes = service;
          completeAt = assignment.plannedCompleteAt ??
            addMinutes(pickupAt, service + assignment.serviceModuleMinutes);
        }
      }
    }
  }

  // etaAvailable requires the FULL chain: deadhead AND service leg AND a
  // completion time. A plan whose completion time is unknown is incomplete
  // and must be flagged, even when the deadhead leg was resolvable.
  if (
    departAt != null &&
    pickupAt != null &&
    deadheadMinutes != null &&
    serviceMinutes != null &&
    completeAt != null
  ) {
    return {
      assignmentId: assignment.assignmentId,
      orderId: assignment.orderId,
      sequenceNo: assignment.sequenceNo,
      slot: SEQ_TO_SLOT[assignment.sequenceNo],
      plannedDepartAt: departAt,
      plannedPickupAt: pickupAt,
      plannedCompleteAt: completeAt,
      deadheadEtaMinutes: deadheadMinutes,
      serviceEtaMinutes: serviceMinutes,
      etaAvailable: true,
    };
  }

  // ETA unavailable — include what we can and flag it with the most
  // specific reason.
  const reason: EtaUnavailableReasonV2 =
    !hasOrigin || !hasDest || deadheadMinutes == null
      ? etaUnavailableReason(hasOrigin, hasDest)
      : !hasDelivery
        ? "DESTINATION_MISSING"
        : "AMAP_UNAVAILABLE";

  return {
    assignmentId: assignment.assignmentId,
    orderId: assignment.orderId,
    sequenceNo: assignment.sequenceNo,
    slot: SEQ_TO_SLOT[assignment.sequenceNo],
    plannedDepartAt: departAt,
    plannedPickupAt: pickupAt,
    plannedCompleteAt: completeAt ?? assignment.plannedCompleteAt,
    deadheadEtaMinutes: deadheadMinutes,
    serviceEtaMinutes: serviceMinutes,
    etaAvailable: false,
    etaUnavailableReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Find the best slot for an unassigned order
// ---------------------------------------------------------------------------

type CandidateSlot = {
  driverId: string;
  sequenceNo: PlanSequenceV2;
  cursor: DriverCursor;
  /** Cursor time the driver would depart at (known — guarded upstream). */
  departAt: IsoDateTimeStringV2;
  deadheadMinutes: number;
  projectedPickupAt: IsoDateTimeStringV2;
};

/**
 * Bound imposed by LATER immobile assignments when filling the empty slot at
 * `seqNo` on the same driver's plan.
 *
 * Frozen overlap rule (contract: `DispatchAssignmentInputV2.plannedDepartAt`):
 *   - The new assignment must be COMPLETED before the driver has to DEPART
 *     for a later locked/executing slot: plannedCompleteAt <= plannedDepartAt.
 *   - When ANY later immobile slot is missing `plannedDepartAt`, filling this
 *     earlier empty slot is FORBIDDEN outright (conservative). The missing
 *     bound is never inferred — not from plannedCompleteAt, not from a fake
 *     ETA, not from any fallback computation.
 */
type LaterImmobileBound =
  | { kind: "NONE" }
  | { kind: "BOUND"; departAt: IsoDateTimeStringV2 }
  | { kind: "FORBIDDEN" };

function laterImmobileBound(
  immobileBySeq: Map<PlanSequenceV2, DispatchAssignmentInputV2> | undefined,
  seqNo: PlanSequenceV2
): LaterImmobileBound {
  let departBound: IsoDateTimeStringV2 | null = null;
  if (immobileBySeq) {
    for (const laterSeq of [1, 2, 3] as PlanSequenceV2[]) {
      if (laterSeq <= seqNo) continue;
      const later = immobileBySeq.get(laterSeq);
      if (!later) continue;
      if (later.plannedDepartAt == null) {
        return { kind: "FORBIDDEN" };
      }
      // Respect ALL later bounds — keep the earliest departure time.
      if (departBound == null || isAfter(departBound, later.plannedDepartAt)) {
        departBound = later.plannedDepartAt;
      }
    }
  }
  return departBound == null
    ? { kind: "NONE" }
    : { kind: "BOUND", departAt: departBound };
}

function findBestSlot(
  order: DispatchOrderInputV2,
  candidates: readonly DispatchDriverInputV2[],
  driverSlots: Map<string, PlanSequenceV2[]>,    // available slots per driver
  getCursorForSlot: (driverId: string, seqNo: PlanSequenceV2) => DriverCursor,
  immobileByDriver: Map<string, Map<PlanSequenceV2, DispatchAssignmentInputV2>>,
  etaResolver: EtaResolver
): {
  best: CandidateSlot | null;
  serviceEtaMinutes: number | null;
  etaUnavailable: boolean;
  infeasible: boolean;
} {
  let bestSlot: CandidateSlot | null = null;
  let bestDeadhead = Infinity;
  let anyEtaAvailable = false;
  let serviceEtaGapAtLockedBound = false;
  let cursorTimeUnknown = false;

  // The service leg (pickup → delivery) is driver-independent — resolve once.
  const serviceEtaMinutes =
    order.pickupLocation && order.deliveryLocation
      ? etaResolver(order.pickupLocation, order.deliveryLocation)
      : null;

  for (const driver of candidates) {
    const slots = driverSlots.get(driver.driverId);
    if (!slots || slots.length === 0) continue;

    // Iterate ALL open slots for this driver (P1 fix, per review ruling
    // 2026-07-19). A slot whose preceding immobile bound makes it infeasible
    // does not preclude a later slot from being feasible.
    for (const seqNo of slots) {
      // Compute cursor ON DEMAND for this (driver, seqNo) pair — the
      // assignment map may have been mutated by earlier order placements.
      const cursor = getCursorForSlot(driver.driverId, seqNo);

      if (cursor.availableAt == null) {
        // The driver's timeline past an immobile assignment without a stored
        // plannedCompleteAt is UNKNOWN — this slot cannot be planned, and the
        // missing time must never be recomputed via the ETA resolver.
        cursorTimeUnknown = true;
        continue;
      }

      if (!cursor.position || !order.pickupLocation) {
        // ETA unavailable for this driver-slot combination
        continue;
      }

      const deadhead = etaResolver(cursor.position, order.pickupLocation);
      if (deadhead == null) {
        continue;
      }

      anyEtaAvailable = true;
      const departAt = cursor.availableAt;
      const projectedPickupAt = addMinutes(departAt, deadhead);
      const slack = minutesBetween(projectedPickupAt, order.promisedPickupAt);

      if (slack < -30) {
        // INFEASIBLE — skip this slot
        continue;
      }

      // Filling a gap BEFORE a locked/executing slot must not overlap it: the
      // new assignment has to be completed before the driver must DEPART for
      // the locked slot (frozen rule — plannedCompleteAt <= plannedDepartAt).
      const bound = laterImmobileBound(immobileByDriver.get(driver.driverId), seqNo);
      if (bound.kind === "FORBIDDEN") {
        // Defensive: forbidden slots are already excluded from driverSlots.
        continue;
      }
      if (bound.kind === "BOUND") {
        if (serviceEtaMinutes == null) {
          // Cannot prove the order fits before the locked slot — skip
          // conservatively and record the data gap.
          serviceEtaGapAtLockedBound = true;
          continue;
        }
        const projectedCompleteAt = addMinutes(
          projectedPickupAt,
          serviceEtaMinutes + order.serviceModuleMinutes
        );
        if (isAfter(projectedCompleteAt, bound.departAt)) {
          // Would overlap the locked slot's timeline — this gap cannot host it.
          continue;
        }
      }

      // Comparator: (deadheadMinutes, driverId, seqNo) lexicographic.
      // Per PRD V2 §6.2: "在可行组合中，优先选择衔接 ETA 最短的司机与槽位".
      if (deadhead < bestDeadhead) {
        bestDeadhead = deadhead;
        bestSlot = { driverId: driver.driverId, sequenceNo: seqNo, cursor, departAt, deadheadMinutes: deadhead, projectedPickupAt };
      } else if (deadhead === bestDeadhead && bestSlot) {
        // Tie-break by driverId for deterministic output
        if (driver.driverId < bestSlot.driverId) {
          bestSlot = { driverId: driver.driverId, sequenceNo: seqNo, cursor, departAt, deadheadMinutes: deadhead, projectedPickupAt };
        } else if (driver.driverId === bestSlot.driverId && seqNo < bestSlot.sequenceNo) {
          // Same driver, same deadhead → prefer earlier slot
          bestSlot = { driverId: driver.driverId, sequenceNo: seqNo, cursor, departAt, deadheadMinutes: deadhead, projectedPickupAt };
        }
      }
    }
  }

  if (bestSlot) {
    return { best: bestSlot, serviceEtaMinutes, etaUnavailable: false, infeasible: false };
  }

  // Determine whether ANY candidate driver has an available slot.
  // If no driver has capacity, the order is infeasible (not eta-unavailable).
  let anyHasSlot = false;
  for (const driver of candidates) {
    const slots = driverSlots.get(driver.driverId);
    if (slots && slots.length > 0) {
      anyHasSlot = true;
      break;
    }
  }

  if (!anyHasSlot) {
    return { best: null, serviceEtaMinutes, etaUnavailable: false, infeasible: true };
  }

  // A candidate was rejected only because of a DATA GAP — either the
  // service-leg ETA needed to verify the locked-slot bound was unavailable,
  // or the driver's timeline past an immobile assignment is unknown (missing
  // stored plannedCompleteAt). Data gaps are not proven infeasibility.
  if (serviceEtaGapAtLockedBound || cursorTimeUnknown) {
    return { best: null, serviceEtaMinutes, etaUnavailable: true, infeasible: false };
  }

  // Slots exist. Distinguish "ETA unavailable for all" vs "all infeasible".
  if (anyEtaAvailable) {
    // We had valid ETA data for some combos but none met the constraints
    return { best: null, serviceEtaMinutes, etaUnavailable: false, infeasible: true };
  }

  // Slots exist but ETA was unavailable for every candidate combination
  return { best: null, serviceEtaMinutes, etaUnavailable: true, infeasible: false };
}

// ---------------------------------------------------------------------------
// Main planner
// ---------------------------------------------------------------------------

export type PlannerResult = {
  proposals: Map<string, PlannedAssignment[]>;
  infeasibleOrderIds: string[];
  etaUnavailableOrderIds: string[];
};

/**
 * Core slot planner.
 *
 * For each candidate driver, identifies immobile assignments (that stay in place)
 * and then greedily assigns unassigned / released orders to the best available slots.
 *
 * Pure function — deterministic, no side effects.
 */
export function planSlots(
  allDrivers: readonly DispatchDriverInputV2[],
  candidateDrivers: readonly DispatchDriverInputV2[],
  orders: readonly DispatchOrderInputV2[],
  now: IsoDateTimeStringV2,
  etaResolver: EtaResolver
): PlannerResult {
  // --- Build order lookup ---
  const orderMap = new Map<string, DispatchOrderInputV2>();
  for (const o of orders) {
    orderMap.set(o.orderId, o);
  }

  // --- Process existing assignments per driver ---
  // driverAssignments: sequenceNo → assignment (immobile stays, mobile is released)
  const driverAssignments = new Map<string, Map<PlanSequenceV2, DispatchAssignmentInputV2>>();
  const driverCursors = new Map<string, DriverCursor>();
  const releasedPlannedOrderIds = new Set<string>();

  for (const d of allDrivers) {
    const seqMap = new Map<PlanSequenceV2, DispatchAssignmentInputV2>();
    for (const a of d.assignments) {
      // Terminal assignments are discarded outright — they occupy no slot,
      // advance no cursor, and their orders never re-enter the pool.
      // This check precedes lockType: a MANUAL_LOCKED + COMPLETED
      // assignment is still terminal and must be dropped.
      if (TERMINAL_ASSIGNMENT_STATUSES.has(a.executionStatus)) {
        continue;
      }
      if (isImmobile(a, orderMap)) {
        seqMap.set(a.sequenceNo, a);
      } else {
        // Mobile PLANNED assignments release their orders for replanning.
        // (EN_ROUTE / IN_SERVICE are immobile, so they never reach here.)
        if (a.executionStatus === "PLANNED") {
          releasedPlannedOrderIds.add(a.orderId);
        }
      }
    }
    driverAssignments.set(d.driverId, seqMap);

    // Initial cursor
    const pos: GeoPointV2 | null = d.lastLocation
      ? { lat: d.lastLocation.lat, lng: d.lastLocation.lng }
      : null;
    driverCursors.set(d.driverId, {
      position: pos,
      availableAt: now,
      etaAvailable: pos != null,
    });
  }

  // Snapshot of immobile assignments per driver — driverAssignments is later
  // mutated with newly planned (mobile) assignments, but the locked-slot
  // bound check must only consider genuinely immobile slots.
  const immobileByDriver = new Map<string, Map<PlanSequenceV2, DispatchAssignmentInputV2>>();
  for (const [driverId, seqMap] of driverAssignments) {
    immobileByDriver.set(driverId, new Map(seqMap));
  }

  // Advance a cursor past an assignment. Immobile assignments advance ONLY
  // via their stored plan (verbatim; a missing plannedCompleteAt makes the
  // cursor time UNKNOWN — it is never recomputed with the ETA resolver).
  // Everything else is recomputed via the injected resolver.
  const advancePast = (cursor: DriverCursor, a: DispatchAssignmentInputV2): DriverCursor =>
    isImmobile(a, orderMap)
      ? advanceCursorForImmobile(a)
      : advanceCursor(cursor, a, etaResolver);

  // --- Build available slot map for candidate drivers ---
  // availableSlots: list of currently open sequenceNos per driver. Empty
  // slots BEFORE an immobile slot whose plannedDepartAt is missing are
  // excluded outright (frozen rule: no bound → filling is forbidden).
  const availableSlots = new Map<string, PlanSequenceV2[]>();
  for (const d of candidateDrivers) {
    const seqMap = driverAssignments.get(d.driverId)!;
    const immobileBySeq = immobileByDriver.get(d.driverId);
    const slots: PlanSequenceV2[] = [];
    for (const seqNo of [1, 2, 3] as PlanSequenceV2[]) {
      if (seqMap.has(seqNo)) continue;
      if (laterImmobileBound(immobileBySeq, seqNo).kind === "FORBIDDEN") continue;
      slots.push(seqNo);
    }
    availableSlots.set(d.driverId, slots);
  }

  function computeCursorForSlot(
    driverId: string,
    targetSeqNo: PlanSequenceV2
  ): DriverCursor {
    const seqMap = driverAssignments.get(driverId);
    if (!seqMap) {
      return driverCursors.get(driverId)!;
    }

    let cursor: DriverCursor = { ...driverCursors.get(driverId)! };
    for (const seqNo of [1, 2, 3] as PlanSequenceV2[]) {
      if (seqNo >= targetSeqNo) break;
      const a = seqMap.get(seqNo);
      if (a) {
        cursor = advancePast(cursor, a);
      }
    }
    return cursor;
  }

  // --- Determine order pool ---
  // Collect all orderIds that are covered by immobile assignments
  const immobileOrderIds = new Set<string>();
  for (const [, seqMap] of driverAssignments) {
    for (const [, a] of seqMap) {
      immobileOrderIds.add(a.orderId);
    }
  }

  // Pool whitelist (P0-1 fix, per review ruling 2026-07-19):
  //   1. UNASSIGNED orders (via filterDispatchableOrders)
  //   2. Orders from explicitly released PLANNED assignments
  // Both legs exclude orders already covered by immobile assignments
  // (prevents double-planning when snapshots are inconsistent).
  // EN_ROUTE / IN_SERVICE / COMPLETED / CANCELLED orders never enter the
  // pool — even when no assignment references them (silently excluded).
  const unassignedOrders = filterDispatchableOrders(orders).filter(
    (o) => !immobileOrderIds.has(o.orderId)
  );
  const releasedOrders = orders.filter(
    (o) =>
      o.executionStatus === "PLANNED" &&
      releasedPlannedOrderIds.has(o.orderId) &&
      !immobileOrderIds.has(o.orderId)
  );
  const pool = [...unassignedOrders, ...releasedOrders];
  const sortedPool = [...pool].sort((a, b) => {
    const t =
      new Date(a.promisedPickupAt).getTime() -
      new Date(b.promisedPickupAt).getTime();
    if (t !== 0) return t;
    return a.orderId.localeCompare(b.orderId);
  });

  // --- Assign orders ---
  const infeasibleOrderIds: string[] = [];
  const etaUnavailableOrderIds: string[] = [];

  for (const order of sortedPool) {
    const result = findBestSlot(
      order,
      candidateDrivers,
      availableSlots,
      (driverId, seqNo) => computeCursorForSlot(driverId, seqNo),
      immobileByDriver,
      etaResolver
    );

    if (result.best && !result.infeasible && !result.etaUnavailable) {
      const { driverId, sequenceNo, departAt, projectedPickupAt } = result.best;
      const pickupAt = projectedPickupAt;
      const completeAt = result.serviceEtaMinutes != null
        ? addMinutes(pickupAt, result.serviceEtaMinutes + order.serviceModuleMinutes)
        : undefined;

      // Create a synthetic assignment input for this new plan. The computed
      // planned times are carried on the input so downstream cursor
      // advancement and proposal building reuse them consistently. (The
      // input contract only carries depart/complete times — the pickup time
      // is recomputed deterministically when the proposal is built.)
      const plannedAsg: DispatchAssignmentInputV2 = {
        assignmentId: `planned:${order.orderId}`,
        orderId: order.orderId,
        sequenceNo,
        lockType: "NONE",
        executionStatus: "PLANNED",
        pickupLocation: order.pickupLocation,
        deliveryLocation: order.deliveryLocation,
        plannedDepartAt: departAt,
        plannedCompleteAt: completeAt,
        serviceModuleMinutes: order.serviceModuleMinutes,
      };

      // Add to the driver's sequence map
      const seqMap = driverAssignments.get(driverId)!;
      seqMap.set(sequenceNo, plannedAsg);

      // Update available slots for this driver
      const slots = availableSlots.get(driverId)!;
      const idx = slots.indexOf(sequenceNo);
      if (idx >= 0) slots.splice(idx, 1);
    } else if (result.etaUnavailable) {
      etaUnavailableOrderIds.push(order.orderId);
    } else {
      infeasibleOrderIds.push(order.orderId);
    }
  }

  // --- Build proposals ---
  // For ALL drivers (not just candidates), produce a proposal
  const proposals = new Map<string, PlannedAssignment[]>();

  for (const d of allDrivers) {
    const seqMap = driverAssignments.get(d.driverId)!;
    const out: PlannedAssignment[] = [];

    // Start from initial cursor, walk through seqNo 1..3
    let cursor: DriverCursor = { ...driverCursors.get(d.driverId)! };

    for (const seqNo of [1, 2, 3] as PlanSequenceV2[]) {
      const asg = seqMap.get(seqNo);
      if (!asg) continue;

      const immobile = isImmobile(asg, orderMap);
      const planned = buildPlannedAssignment(asg, cursor, etaResolver, immobile);
      out.push(planned);

      // Advance cursor for next slot
      cursor = advancePast(cursor, asg);
    }

    proposals.set(d.driverId, out);
  }

  return { proposals, infeasibleOrderIds, etaUnavailableOrderIds };
}

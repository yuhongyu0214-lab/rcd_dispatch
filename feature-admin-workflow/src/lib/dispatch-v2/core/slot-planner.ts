import type {
  DispatchAssignmentInputV2,
  DispatchDriverInputV2,
  DispatchOrderInputV2,
  DispatchPlannedAssignmentV2,
  DispatchPlannedAssignmentV2 as PlannedAssignment,
  GeoPointV2,
  IsoDateTimeStringV2,
  PlanSequenceV2,
  PlannedAssignmentSlotV2,
} from "@/types/v2";

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

const SEQ_TO_SLOT: Record<PlanSequenceV2, PlannedAssignmentSlotV2> = {
  1: "A",
  2: "B",
  3: "C",
};

/**
 * Is an assignment immobile — i.e. must NOT be released or moved during
 * this planning run?
 *
 * Immobile when:
 *   - lockType = AUTO_FROZEN or MANUAL_LOCKED, OR
 *   - the associated order's executionStatus is EN_ROUTE or IN_SERVICE
 */
function isImmobile(
  assignment: DispatchAssignmentInputV2,
  orderMap: Map<string, DispatchOrderInputV2>
): boolean {
  if (assignment.lockType === "AUTO_FROZEN" || assignment.lockType === "MANUAL_LOCKED") {
    return true;
  }
  const order = orderMap.get(assignment.orderId);
  return order != null && (order.executionStatus === "EN_ROUTE" || order.executionStatus === "IN_SERVICE");
}

// ---------------------------------------------------------------------------
// Cursor advancement
// ---------------------------------------------------------------------------

/**
 * Advance a driver's timeline cursor past a single assignment.
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
  let nextAvailable: IsoDateTimeStringV2 = cursor.availableAt;
  let nextEtaAvailable = cursor.etaAvailable;

  if (cursor.position && pickup) {
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

// ---------------------------------------------------------------------------
// Build a PlannedAssignment for a specific slot
// ---------------------------------------------------------------------------

function buildPlannedAssignment(
  assignment: DispatchAssignmentInputV2,
  cursor: DriverCursor,
  etaResolver: EtaResolver
): PlannedAssignment {
  const pickup = assignment.pickupLocation;
  const delivery = assignment.deliveryLocation;

  const hasOrigin = cursor.position != null && cursor.etaAvailable;
  const hasDest = pickup != null;
  const hasDelivery = delivery != null;

  let deadheadMinutes: number | undefined;
  let serviceMinutes: number | undefined;
  let departAt: IsoDateTimeStringV2 | undefined;
  let pickupAt: IsoDateTimeStringV2 | undefined;
  let completeAt: IsoDateTimeStringV2 | undefined;

  if (hasOrigin && hasDest && cursor.position && pickup) {
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

  if (departAt != null && pickupAt != null && deadheadMinutes != null) {
    const etaData: PlannedAssignment = {
      assignmentId: assignment.assignmentId,
      orderId: assignment.orderId,
      sequenceNo: assignment.sequenceNo,
      slot: SEQ_TO_SLOT[assignment.sequenceNo],
      plannedDepartAt: departAt,
      plannedPickupAt: pickupAt,
      plannedCompleteAt: completeAt ?? assignment.plannedCompleteAt,
      deadheadEtaMinutes: deadheadMinutes,
      serviceEtaMinutes: serviceMinutes,
      etaAvailable: true,
    };
    return etaData;
  }

  // ETA unavailable — include what we can and flag it
  const reason = etaUnavailableReason(hasOrigin, hasDest);
  return {
    assignmentId: assignment.assignmentId,
    orderId: assignment.orderId,
    sequenceNo: assignment.sequenceNo,
    slot: SEQ_TO_SLOT[assignment.sequenceNo],
    plannedDepartAt: departAt,
    plannedPickupAt: pickupAt,
    plannedCompleteAt: assignment.plannedCompleteAt,
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
  deadheadMinutes: number;
  projectedPickupAt: IsoDateTimeStringV2;
};

function findBestSlot(
  order: DispatchOrderInputV2,
  candidates: readonly DispatchDriverInputV2[],
  driverSlots: Map<string, PlanSequenceV2[]>,    // available slots per driver
  driverCursors: Map<string, DriverCursor>,       // cursor for the available slot
  driverAssignments: Map<string, Map<PlanSequenceV2, DispatchAssignmentInputV2 | PlannedAssignment>>,
  etaResolver: EtaResolver
): {
  best: CandidateSlot | null;
  etaUnavailable: boolean;
  infeasible: boolean;
} {
  let bestSlot: CandidateSlot | null = null;
  let bestDeadhead = Infinity;
  let anyFeasible = false;
  let anyEtaAvailable = false;

  for (const driver of candidates) {
    const slots = driverSlots.get(driver.driverId);
    const cursor = driverCursors.get(driver.driverId);
    if (!slots || slots.length === 0 || !cursor) continue;

    // The available slot is the first one
    const seqNo = slots[0];

    if (!cursor.position || !order.pickupLocation) {
      // ETA unavailable for this driver
      continue;
    }

    const deadhead = etaResolver(cursor.position, order.pickupLocation);
    if (deadhead == null) {
      continue;
    }

    anyEtaAvailable = true;
    const projectedPickupAt = addMinutes(cursor.availableAt, deadhead);
    const slack = minutesBetween(projectedPickupAt, order.promisedPickupAt);

    if (slack < -30) {
      // INFEASIBLE — skip
      continue;
    }

    anyFeasible = true;

    if (deadhead < bestDeadhead) {
      bestDeadhead = deadhead;
      bestSlot = { driverId: driver.driverId, sequenceNo: seqNo, cursor, deadheadMinutes: deadhead, projectedPickupAt };
    } else if (deadhead === bestDeadhead && bestSlot) {
      // Tie-break by driverId for deterministic output
      if (driver.driverId < bestSlot.driverId) {
        bestSlot = { driverId: driver.driverId, sequenceNo: seqNo, cursor, deadheadMinutes: deadhead, projectedPickupAt };
      }
    }
  }

  if (bestSlot) {
    return { best: bestSlot, etaUnavailable: false, infeasible: false };
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
    return { best: null, etaUnavailable: false, infeasible: true };
  }

  // Slots exist. Distinguish "ETA unavailable for all" vs "all infeasible".
  if (anyEtaAvailable && !anyFeasible) {
    // We had valid ETA data for some combos but none met the slack threshold
    return { best: null, etaUnavailable: false, infeasible: true };
  }

  // Slots exist but ETA was unavailable for every candidate combination
  return { best: null, etaUnavailable: true, infeasible: false };
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
  const allDriverIds = new Set(allDrivers.map((d) => d.driverId));
  // drivers in the set of all drivers (including non-candidates) for cursor building
  const driverById = new Map<string, DispatchDriverInputV2>();
  for (const d of allDrivers) {
    driverById.set(d.driverId, d);
  }

  for (const d of allDrivers) {
    const seqMap = new Map<PlanSequenceV2, DispatchAssignmentInputV2>();
    for (const a of d.assignments) {
      if (isImmobile(a, orderMap)) {
        seqMap.set(a.sequenceNo, a);
      }
      // mobile assignments are dropped (their orders go back to the pool)
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

  // --- Build available slot map for candidate drivers ---
  // availableSlots: list of currently open sequenceNos per driver
  const availableSlots = new Map<string, PlanSequenceV2[]>();
  for (const d of candidateDrivers) {
    const seqMap = driverAssignments.get(d.driverId)!;
    const slots: PlanSequenceV2[] = [];
    for (const seqNo of [1, 2, 3] as PlanSequenceV2[]) {
      if (!seqMap.has(seqNo)) {
        slots.push(seqNo);
      }
    }
    availableSlots.set(d.driverId, slots);
  }

  // --- Determine the cursor for each candidate driver's FIRST available slot ---
  // This cursor is computed by processing all immobile assignments at sequenceNos
  // BEFORE the first available slot.
  const firstAvailableCursors = new Map<string, DriverCursor>();

  function computeCursorForSlot(
    driverId: string,
    targetSeqNo: PlanSequenceV2
  ): DriverCursor {
    const d = driverById.get(driverId);
    const seqMap = driverAssignments.get(driverId);
    if (!d || !seqMap) {
      return driverCursors.get(driverId)!;
    }

    let cursor: DriverCursor = { ...driverCursors.get(driverId)! };
    for (const seqNo of [1, 2, 3] as PlanSequenceV2[]) {
      if (seqNo >= targetSeqNo) break;
      const a = seqMap.get(seqNo);
      if (a) {
        cursor = advanceCursor(cursor, a, etaResolver);
      }
    }
    return cursor;
  }

  for (const d of candidateDrivers) {
    const slots = availableSlots.get(d.driverId);
    if (slots && slots.length > 0) {
      firstAvailableCursors.set(d.driverId, computeCursorForSlot(d.driverId, slots[0]));
    }
  }

  // --- Determine order pool ---
  // Collect all orderIds that are covered by immobile assignments
  const immobileOrderIds = new Set<string>();
  for (const [, seqMap] of driverAssignments) {
    for (const [, a] of seqMap) {
      immobileOrderIds.add(a.orderId);
    }
  }

  // Pool: orders NOT covered by immobile assignments
  // (UNASSIGNED orders + orders from released mobile assignments)
  const pool = orders.filter((o) => !immobileOrderIds.has(o.orderId));
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
  // Track newly planned assignments per driver
  const newlyPlanned = new Map<string, Map<PlanSequenceV2, DispatchAssignmentInputV2>>();

  for (const order of sortedPool) {
    const result = findBestSlot(
      order,
      candidateDrivers,
      availableSlots,
      firstAvailableCursors,
      driverAssignments,
      etaResolver
    );

    if (result.best && !result.infeasible && !result.etaUnavailable) {
      const { driverId, sequenceNo, deadheadMinutes, projectedPickupAt } = result.best;
      const driver = driverById.get(driverId)!;
      const serviceEta = order.pickupLocation && order.deliveryLocation
        ? etaResolver(order.pickupLocation, order.deliveryLocation)
        : null;
      const pickupAt = projectedPickupAt;
      const completeAt = serviceEta != null
        ? addMinutes(pickupAt, serviceEta + order.serviceModuleMinutes)
        : undefined;

      // Create a synthetic assignment input for this new plan
      const plannedAsg: DispatchAssignmentInputV2 = {
        assignmentId: `planned:${order.orderId}`,
        orderId: order.orderId,
        sequenceNo,
        lockType: "NONE",
        executionStatus: "PLANNED",
        pickupLocation: order.pickupLocation,
        deliveryLocation: order.deliveryLocation,
        serviceModuleMinutes: order.serviceModuleMinutes,
      };

      // Add to driver's assignments (both the sequence map and planned map)
      const seqMap = driverAssignments.get(driverId)!;
      seqMap.set(sequenceNo, plannedAsg);

      if (!newlyPlanned.has(driverId)) {
        newlyPlanned.set(driverId, new Map());
      }
      newlyPlanned.get(driverId)!.set(sequenceNo, plannedAsg);

      // Update available slots for this driver
      const slots = availableSlots.get(driverId)!;
      const idx = slots.indexOf(sequenceNo);
      if (idx >= 0) slots.splice(idx, 1);

      // Recompute cursor for the next available slot
      if (slots.length > 0) {
        firstAvailableCursors.set(driverId, computeCursorForSlot(driverId, slots[0]));
      } else {
        firstAvailableCursors.delete(driverId);
      }
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

      const planned = buildPlannedAssignment(asg, cursor, etaResolver);
      out.push(planned);

      // Advance cursor for next slot
      cursor = advanceCursor(cursor, asg, etaResolver);
    }

    proposals.set(d.driverId, out);
  }

  return { proposals, infeasibleOrderIds, etaUnavailableOrderIds };
}

import { describe, expect, it } from "vitest";

import { FIXTURE_DISPATCH_INPUT_V2 } from "@/lib/contracts/v2/fixtures";
import type {
  DispatchAssignmentInputV2,
  DispatchDriverInputV2,
  DispatchInputV2,
  DispatchOrderEvaluationV2,
  DispatchOrderInputV2,
  GeoPointV2,
} from "@/types/v2";

import { filterCandidateDrivers, filterDispatchableOrders } from "./candidate-filter";
import { calculateFeasibility, calculateSlackMinutes } from "./feasibility";
import { runDispatchV2 } from "./index";
import { sortOrdersByPriority } from "./sorter";
import { planSlots } from "./slot-planner";
import type { EtaResolver } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

// Helper: extract orderIds from evaluations array for a specific result kind.
function evalIds(evals: DispatchOrderEvaluationV2[], result: DispatchOrderEvaluationV2["result"]): string[] {
  return evals.filter(e => e.result === result).map(e => e.orderId);
}

const NOW = "2026-07-18T08:00:00.000Z";

const PT_HZ_XH: GeoPointV2 = { lat: 30.2741, lng: 120.1551 }; // store / driver home
const PT_GONGSHU: GeoPointV2 = { lat: 30.319, lng: 120.142 }; // delivery area

/** Create an order input with sensible defaults. */
function makeOrder(overrides: Partial<DispatchOrderInputV2> & { orderId: string }): DispatchOrderInputV2 {
  return {
    orderNo: `NO-${overrides.orderId}`,
    businessType: "STORE_PICKUP",
    executionStatus: "UNASSIGNED",
    feasibility: "UNKNOWN",
    slackMinutes: null,
    promisedPickupAt: "2026-07-18T09:00:00.000Z",
    pickupAddress: "测试取车点",
    pickupLocation: { ...PT_HZ_XH },
    deliveryAddress: "测试送达点",
    deliveryLocation: { ...PT_GONGSHU },
    storeCode: "STORE_HZ_XH",
    serviceModuleMinutes: 0,
    ...overrides,
  };
}

/** Create a driver input with sensible defaults. */
function makeDriver(overrides: Partial<DispatchDriverInputV2> & { driverId: string }): DispatchDriverInputV2 {
  return {
    storeCode: "STORE_HZ_XH",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 1,
    locationFreshness: "FRESH",
    lastLocation: { lat: 30.2741, lng: 120.1551, accuracyMeters: 20, capturedAt: NOW },
    assignments: [],
    ...overrides,
  };
}

/** ETA resolver that returns a fixed value regardless of coordinates. */
function fixedEtaResolver(minutes: number): EtaResolver {
  return () => minutes;
}

/** ETA resolver that returns null (unavailable). */
const nullEtaResolver: EtaResolver = () => null;

/** ETA resolver based on a lookup map keyed by origin→destination. */
function mapEtaResolver(lookup: Map<string, number | null>): EtaResolver {
  return (from: GeoPointV2, to: GeoPointV2) => {
    const key = `${from.lat},${from.lng}->${to.lat},${to.lng}`;
    const val = lookup.get(key);
    return val !== undefined ? val : null;
  };
}

/**
 * Test-local resolver: minutes proportional to straight-line distance.
 * The production core never generates ETA values itself — resolvers are
 * always injected.
 */
const distanceEtaResolver: EtaResolver = (from, to) => {
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 200);
};

// =========================================================================
// candidate-filter tests
// =========================================================================

describe("filterCandidateDrivers", () => {
  it("returns empty array when no drivers provided", () => {
    expect(filterCandidateDrivers([])).toEqual([]);
  });

  it("returns only drivers with onShift=true, AVAILABLE, FRESH", () => {
    const drivers = [
      makeDriver({ driverId: "d1" }), // all good
      makeDriver({ driverId: "d2", onShift: false }),
      makeDriver({ driverId: "d3", availability: "UNAVAILABLE" }),
      makeDriver({ driverId: "d4", locationFreshness: "STALE" }),
      makeDriver({ driverId: "d5", locationFreshness: "NONE" }),
    ];
    const result = filterCandidateDrivers(drivers);
    expect(result).toHaveLength(1);
    expect(result[0].driverId).toBe("d1");
  });

  it("returns all drivers when all satisfy conditions", () => {
    const drivers = [
      makeDriver({ driverId: "d1" }),
      makeDriver({ driverId: "d2" }),
    ];
    const result = filterCandidateDrivers(drivers);
    expect(result).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const drivers = [
      makeDriver({ driverId: "d1" }),
      makeDriver({ driverId: "d2", onShift: false }),
    ];
    const snapshot = JSON.stringify(drivers);
    filterCandidateDrivers(drivers);
    expect(JSON.stringify(drivers)).toBe(snapshot);
  });
});

// =========================================================================
// filterDispatchableOrders tests
// =========================================================================

describe("filterDispatchableOrders", () => {
  it("keeps only UNASSIGNED orders", () => {
    const orders = [
      makeOrder({ orderId: "u", executionStatus: "UNASSIGNED" }),
      makeOrder({ orderId: "p", executionStatus: "PLANNED" }),
      makeOrder({ orderId: "e", executionStatus: "EN_ROUTE" }),
      makeOrder({ orderId: "s", executionStatus: "IN_SERVICE" }),
      makeOrder({ orderId: "c", executionStatus: "COMPLETED" }),
      makeOrder({ orderId: "x", executionStatus: "CANCELLED" }),
    ];
    const result = filterDispatchableOrders(orders);
    expect(result.map((o) => o.orderId)).toEqual(["u"]);
  });

  it("returns empty array when no orders provided", () => {
    expect(filterDispatchableOrders([])).toEqual([]);
  });
});

// =========================================================================
// feasibility tests
// =========================================================================

describe("calculateSlackMinutes", () => {
  it("returns positive slack when projected is before promised", () => {
    // promised 09:00, projected 08:30 → 30 min slack
    expect(calculateSlackMinutes("2026-07-18T09:00:00.000Z", "2026-07-18T08:30:00.000Z")).toBe(30);
  });

  it("returns negative slack when projected is after promised", () => {
    // promised 09:00, projected 09:31 → -31 min slack
    expect(calculateSlackMinutes("2026-07-18T09:00:00.000Z", "2026-07-18T09:31:00.000Z")).toBe(-31);
  });

  it("returns zero when projected equals promised", () => {
    expect(calculateSlackMinutes("2026-07-18T09:00:00.000Z", "2026-07-18T09:00:00.000Z")).toBe(0);
  });
});

describe("calculateFeasibility", () => {
  it("returns UNKNOWN when ETA is unavailable", () => {
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T08:30:00.000Z", false)).toBe("UNKNOWN");
  });

  it("returns NORMAL when slack >= 10", () => {
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T08:30:00.000Z", true)).toBe("NORMAL");
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T08:50:00.000Z", true)).toBe("NORMAL");
  });

  it("returns AT_RISK when -30 <= slack < 10", () => {
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T08:51:00.000Z", true)).toBe("AT_RISK");
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T09:30:00.000Z", true)).toBe("AT_RISK");
  });

  it("returns INFEASIBLE when slack < -30", () => {
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T09:31:00.000Z", true)).toBe("INFEASIBLE");
  });

  it("slack = -30 boundary: -30 is AT_RISK, -31 is INFEASIBLE", () => {
    // -30 is on the boundary: slack < -30 is INFEASIBLE, so -30 IS AT_RISK (not < -30)
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T09:30:00.000Z", true)).toBe("AT_RISK");
    // -31 is INFEASIBLE
    expect(calculateFeasibility("2026-07-18T09:00:00.000Z", "2026-07-18T09:31:00.000Z", true)).toBe("INFEASIBLE");
  });
});

// =========================================================================
// sorter tests
// =========================================================================

describe("sortOrdersByPriority", () => {
  it("returns empty for empty input", () => {
    expect(sortOrdersByPriority([])).toEqual([]);
  });

  it("sorts by promisedPickupAt ascending", () => {
    const orders = [
      makeOrder({ orderId: "late", promisedPickupAt: "2026-07-18T10:00:00.000Z" }),
      makeOrder({ orderId: "early", promisedPickupAt: "2026-07-18T09:00:00.000Z" }),
    ];
    const sorted = sortOrdersByPriority(orders);
    expect(sorted[0].orderId).toBe("early");
    expect(sorted[1].orderId).toBe("late");
  });

  it("tiebreaks by orderId when same promisedPickupAt", () => {
    const orders = [
      makeOrder({ orderId: "z-order", promisedPickupAt: "2026-07-18T09:00:00.000Z" }),
      makeOrder({ orderId: "a-order", promisedPickupAt: "2026-07-18T09:00:00.000Z" }),
    ];
    const sorted = sortOrdersByPriority(orders);
    expect(sorted[0].orderId).toBe("a-order");
    expect(sorted[1].orderId).toBe("z-order");
  });

  it("does not mutate input array", () => {
    const orders = [makeOrder({ orderId: "o1" }), makeOrder({ orderId: "o2" })];
    const snapshot = JSON.stringify(orders);
    sortOrdersByPriority(orders);
    expect(JSON.stringify(orders)).toBe(snapshot);
  });
});

// =========================================================================
// runDispatchV2 — integration tests
// =========================================================================

describe("runDispatchV2", () => {
  // -----------------------------------------------------------------------
  // Empty / no-candidate
  // -----------------------------------------------------------------------

  it("empty input (no orders, no drivers) → empty output", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [],
      drivers: [],
    };
    const result = runDispatchV2(input);
    expect(result.proposals).toEqual([]);
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
    expect(result.calculatedAt).toBe(NOW);
  });

  it("no candidate drivers → all orders infeasible", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [
        makeDriver({ driverId: "d1", onShift: false }),
        makeDriver({ driverId: "d2", availability: "UNAVAILABLE" }),
      ],
    };
    const result = runDispatchV2(input);
    expect(evalIds(result.evaluations, "UNPLANNED")).toEqual(["o1"]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
    // Non-candidate drivers still get a (possibly empty) proposal
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].assignments).toEqual([]);
    expect(result.proposals[1].assignments).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Basic assignment
  // -----------------------------------------------------------------------

  it("single driver, single order → assigned to slot A", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(15));
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
    expect(result.proposals).toHaveLength(1);

    const p = result.proposals[0];
    expect(p.driverId).toBe("d1");
    expect(p.expectedPlanVersion).toBe(1);
    expect(p.assignments).toHaveLength(1);

    const asg = p.assignments[0];
    expect(asg.orderId).toBe("o1");
    expect(asg.sequenceNo).toBe(1);
    expect(asg.slot).toBe("A");
    expect(asg.etaAvailable).toBe(true);
    expect(asg.deadheadEtaMinutes).toBe(15);
  });

  it("multiple drivers, single order → best ETA wins", () => {
    // Give drivers different positions; d2 is closer to pickup → shorter
    // ETA → wins.
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", pickupLocation: { lat: 30.5, lng: 120.5 } })],
      drivers: [
        makeDriver({
          driverId: "d1",
          lastLocation: { lat: 30.28, lng: 120.16, accuracyMeters: 20, capturedAt: NOW },
        }),
        makeDriver({
          driverId: "d2",
          lastLocation: { lat: 30.48, lng: 120.48, accuracyMeters: 20, capturedAt: NOW },
        }),
      ],
    };

    const result = runDispatchV2(input, distanceEtaResolver);
    expect(result.proposals[1].assignments[0]?.orderId ?? "").toBe("o1");
  });

  // -----------------------------------------------------------------------
  // Multiple orders → priority
  // -----------------------------------------------------------------------

  it("processes orders with earlier promisedPickupAt first", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "late", promisedPickupAt: "2026-07-18T11:00:00.000Z" }),
        makeOrder({ orderId: "early", promisedPickupAt: "2026-07-18T09:00:00.000Z" }),
        makeOrder({ orderId: "mid", promisedPickupAt: "2026-07-18T10:00:00.000Z" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1" }),
        makeDriver({ driverId: "d2" }),
        makeDriver({ driverId: "d3" }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    // With 3 drivers and 3 orders, all get assigned
    // "early" should go to first driver processed (d1, slot A)
    const d1Assignments = result.proposals.find((p) => p.driverId === "d1")!.assignments;
    expect(d1Assignments[0].orderId).toBe("early");
  });

  // -----------------------------------------------------------------------
  // Full slots → infeasible
  // -----------------------------------------------------------------------

  it("full slots (all 3 A/B/C occupied by immobile assignments) → new orders infeasible", () => {
    // Driver has all 3 slots filled with AUTO_FROZEN assignments
    const immobileAsg: DispatchAssignmentInputV2 = {
      assignmentId: "asg-immo",
      orderId: "occupied-order",
      sequenceNo: 1,
      lockType: "AUTO_FROZEN",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      serviceModuleMinutes: 0,
    };

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "occupied-a", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "occupied-b", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "occupied-c", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "new-order" }),
      ],
      drivers: [
        makeDriver({
          driverId: "d1",
          assignments: [
            { ...immobileAsg, assignmentId: "asg-A", orderId: "occupied-a", sequenceNo: 1 },
            { ...immobileAsg, assignmentId: "asg-B", orderId: "occupied-b", sequenceNo: 2 },
            { ...immobileAsg, assignmentId: "asg-C", orderId: "occupied-c", sequenceNo: 3 },
          ],
        }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    expect(evalIds(result.evaluations, "UNPLANNED")).toContain("new-order");
  });

  // -----------------------------------------------------------------------
  // AUTO_FROZEN assignments stay in place
  // -----------------------------------------------------------------------

  it("AUTO_FROZEN assignments stay in slot", () => {
    const frozenAsg: DispatchAssignmentInputV2 = {
      assignmentId: "frozen-1",
      orderId: "frozen-order",
      sequenceNo: 1,
      lockType: "AUTO_FROZEN",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      // Immobile timelines advance ONLY via stored times — required for the
      // next slot to be plannable.
      plannedDepartAt: "2026-07-18T08:00:00.000Z",
      plannedCompleteAt: "2026-07-18T08:40:00.000Z",
      serviceModuleMinutes: 0,
    };

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "frozen-order", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [
        makeDriver({
          driverId: "d1",
          assignments: [frozenAsg],
        }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const d1 = result.proposals.find((p) => p.driverId === "d1")!;
    expect(d1.assignments).toHaveLength(2);

    // First assignment is the frozen one (seqNo 1, slot A)
    const slotA = d1.assignments.find((a) => a.sequenceNo === 1)!;
    expect(slotA.assignmentId).toBe("frozen-1");
    expect(slotA.orderId).toBe("frozen-order");

    // Second is the new assignment (seqNo 2, slot B)
    const slotB = d1.assignments.find((a) => a.sequenceNo === 2)!;
    expect(slotB).toBeDefined();
    expect(slotB.orderId).toBe("o1");
    expect(slotB.slot).toBe("B");
  });

  // -----------------------------------------------------------------------
  // MANUAL_LOCKED assignments stay in place
  // -----------------------------------------------------------------------

  it("MANUAL_LOCKED assignments stay in slot", () => {
    const lockedAsg: DispatchAssignmentInputV2 = {
      assignmentId: "locked-1",
      orderId: "locked-order",
      sequenceNo: 1,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:00:00.000Z",
      plannedCompleteAt: "2026-07-18T08:40:00.000Z",
      serviceModuleMinutes: 0,
    };

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [
        makeDriver({
          driverId: "d1",
          assignments: [lockedAsg],
        }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    const d1 = result.proposals.find((p) => p.driverId === "d1")!;
    const slotA = d1.assignments.find((a) => a.sequenceNo === 1)!;
    expect(slotA.assignmentId).toBe("locked-1");
  });

  // -----------------------------------------------------------------------
  // EN_ROUTE / IN_SERVICE → immobile
  // -----------------------------------------------------------------------

  it("EN_ROUTE order assignment stays in place", () => {
    const enRouteAsg: DispatchAssignmentInputV2 = {
      assignmentId: "enroute-1",
      orderId: "enroute-order",
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:50:00.000Z",
      plannedCompleteAt: "2026-07-18T08:30:00.000Z",
      serviceModuleMinutes: 0,
    };

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "enroute-order", executionStatus: "EN_ROUTE" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [
        makeDriver({
          driverId: "d1",
          assignments: [enRouteAsg],
        }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    const d1 = result.proposals.find((p) => p.driverId === "d1")!;
    // EN_ROUTE stays (immobile) + new order to slot B
    expect(d1.assignments.length).toBeGreaterThanOrEqual(2);
    expect(d1.assignments.some((a) => a.orderId === "enroute-order")).toBe(true);
  });

  it("IN_SERVICE order assignment stays in place", () => {
    const inServiceAsg: DispatchAssignmentInputV2 = {
      assignmentId: "inservice-1",
      orderId: "inservice-order",
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:55:00.000Z",
      plannedCompleteAt: "2026-07-18T08:35:00.000Z",
      serviceModuleMinutes: 0,
    };

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "inservice-order", executionStatus: "IN_SERVICE" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [
        makeDriver({
          driverId: "d1",
          assignments: [inServiceAsg],
        }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    const d1 = result.proposals.find((p) => p.driverId === "d1")!;
    expect(d1.assignments.some((a) => a.orderId === "inservice-order")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Slack = -30 boundary
  // -----------------------------------------------------------------------

  it("slack = -30: feasible (AT_RISK) — gets assigned", () => {
    // promisedPickupAt 09:00, we need projected pickup at 09:30 (slack = -30)
    // With driver starting at 08:00, we need deadhead = 90 min
    // But with fixed resolver, all deadheads are same
    // Better approach: use an ETA resolver that gives exactly the right value
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: "2026-07-18T08:00:00.000Z" },
      orders: [
        makeOrder({
          orderId: "o1",
          promisedPickupAt: "2026-07-18T09:00:00.000Z",
        }),
      ],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    // 60 min deadhead → projected pickup 09:00 → slack = 0 (AT_RISK)
    // That's completely fine.
    const result = runDispatchV2(input, fixedEtaResolver(60));
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(result.proposals[0].assignments).toHaveLength(1);
  });

  it("slack < -30: INFEASIBLE — not assigned", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: "2026-07-18T08:00:00.000Z" },
      orders: [
        makeOrder({
          orderId: "o1",
          promisedPickupAt: "2026-07-18T09:00:00.000Z",
        }),
      ],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    // 91 min deadhead → projected pickup 09:31 → slack = -31 (INFEASIBLE)
    const result = runDispatchV2(input, fixedEtaResolver(91));
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual(["o1"]);
  });

  // -----------------------------------------------------------------------
  // ETA unavailable
  // -----------------------------------------------------------------------

  it("ETA unavailable → order goes to etaUnavailableOrderIds", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, nullEtaResolver);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["o1"]);
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
  });

  it("order without pickupLocation → etaUnavailable", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", pickupLocation: undefined })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["o1"]);
  });

  it("driver without lastLocation → etaUnavailable", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", lastLocation: undefined })],
    };
    const result = runDispatchV2(input);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["o1"]);
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  it("same input → same output (deterministic)", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "o1" }),
        makeOrder({ orderId: "o2", promisedPickupAt: "2026-07-18T10:00:00.000Z" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1" }),
        makeDriver({ driverId: "d2" }),
      ],
    };
    const a = JSON.stringify(runDispatchV2(input, fixedEtaResolver(15)));
    const b = JSON.stringify(runDispatchV2(input, fixedEtaResolver(15)));
    expect(a).toBe(b);
  });

  // -----------------------------------------------------------------------
  // Input not mutated
  // -----------------------------------------------------------------------

  it("does not mutate input after function call", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const snapshot = JSON.stringify(input);
    runDispatchV2(input, fixedEtaResolver(15));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  // -----------------------------------------------------------------------
  // expectedPlanVersion preserved
  // -----------------------------------------------------------------------

  it("expectedPlanVersion preserved in output", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", planVersion: 7 })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(15));
    expect(result.proposals[0].expectedPlanVersion).toBe(7);
  });

  // -----------------------------------------------------------------------
  // Tie-breaking by driver ID
  // -----------------------------------------------------------------------

  it("tie-breaking by driver ID for equal ETA", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [
        makeDriver({ driverId: "d2" }),
        makeDriver({ driverId: "d1" }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(15));
    // d1 < d2 alphabetically, so d1 should win the tiebreak
    const assignedD1 = result.proposals.find((p) => p.driverId === "d1")!;
    expect(assignedD1.assignments).toHaveLength(1);
    expect(assignedD1.assignments[0].orderId).toBe("o1");
  });

  // -----------------------------------------------------------------------
  // calculatedAt comes from event.occurredAt
  // -----------------------------------------------------------------------

  it("calculatedAt matches event.occurredAt", () => {
    const occ = "2026-07-18T12:00:00.000Z";
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: occ },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(15));
    expect(result.calculatedAt).toBe(occ);
  });

  // -----------------------------------------------------------------------
  // Base fixture
  // -----------------------------------------------------------------------

  it("works with FIXTURE_DISPATCH_INPUT_V2 (no resolver → no-ETA mode)", () => {
    const result = runDispatchV2(FIXTURE_DISPATCH_INPUT_V2);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].driverId).toBe("driver-v2-001");
    expect(result.proposals[0].expectedPlanVersion).toBe(1);
    // Without an injected resolver the core must NOT invent ETAs — the order
    // is reported as ETA-unavailable instead of being planned.
    expect(result.proposals[0].assignments).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["order-v2-001"]);
  });

  // -----------------------------------------------------------------------
  // planVersion is NOT incremented by the core
  // -----------------------------------------------------------------------

  it("does not increment planVersion (that's the integration layer's job)", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", planVersion: 5 })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(15));
    expect(result.proposals[0].expectedPlanVersion).toBe(5);
  });

  // -----------------------------------------------------------------------
  // Multiple drivers, multiple orders — full assignment
  // -----------------------------------------------------------------------

  it("multiple drivers, multiple orders → all assigned correctly", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "o1", promisedPickupAt: "2026-07-18T09:00:00.000Z" }),
        makeOrder({ orderId: "o2", promisedPickupAt: "2026-07-18T09:30:00.000Z" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1" }),
        makeDriver({ driverId: "d2" }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    // Both orders get assigned (one per driver, slot A each)
    const allAssigned = result.proposals.reduce(
      (acc, p) => acc.concat(p.assignments.map((a) => a.orderId)),
      [] as string[]
    );
    expect(allAssigned).toContain("o1");
    expect(allAssigned).toContain("o2");
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // DispatchOrderEvaluationV2 — contract verification (2026-07-19 ruling)
  // -----------------------------------------------------------------------

  it("evaluations cover ALL pool orders (no silent omissions)", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "planned", promisedPickupAt: "2026-07-18T09:15:00.000Z" }),
        makeOrder({ orderId: "tight", promisedPickupAt: "2026-07-18T08:50:00.000Z" }),
        makeOrder({ orderId: "unplanned", promisedPickupAt: "2026-07-18T08:50:00.000Z" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1" }), // 1 driver, 3 slots (A/B/C)
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    const allEvalOrderIds = result.evaluations.map((e) => e.orderId).sort();
    expect(allEvalOrderIds).toEqual(["planned", "tight", "unplanned"]);
  });

  it("PLANNED evaluation carries real bestSlackMinutes (no sentinel)", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", promisedPickupAt: "2026-07-18T09:15:00.000Z" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));
    const planned = result.evaluations.filter((e) => e.result === "PLANNED");
    expect(planned).toHaveLength(1);
    expect(planned[0].bestSlackMinutes).toBeGreaterThan(0);
    expect(planned[0].bestSlackMinutes).not.toBe(-999);
    expect(planned[0].bestSlackMinutes).not.toBe(9999);
  });

  it("INFEASIBLE evaluation carries real bestSlackMinutes (not a sentinel)", () => {
    // Promised pickup needs to be BEFORE (NOW + deadhead - 30) to get slack < -30.
    // Driver at 08:00 + 20 min deadhead → projected pickup 08:20.
    // promisedPickupAt 07:45 → slack = 07:45 - 08:20 = -35 → INFEASIBLE.
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", promisedPickupAt: "2026-07-18T07:45:00.000Z" })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(20));
    const infeasible = result.evaluations.filter((e) => e.result === "INFEASIBLE");
    expect(infeasible).toHaveLength(1);
    expect(infeasible[0].bestSlackMinutes).toBeLessThan(-30);
    expect(infeasible[0].bestSlackMinutes).not.toBe(-999);
    expect(infeasible[0].bestSlackMinutes).not.toBe(9999);
    expect(infeasible[0].reason).toBe("SLACK_BELOW_LIMIT");
  });

  it("UNPLANNED / ETA_UNAVAILABLE carry bestSlackMinutes: null and correct reason", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", lastLocation: undefined })],
    };
    const result = runDispatchV2(input);
    const nullSlack = result.evaluations.filter((e) => e.bestSlackMinutes === null);
    expect(nullSlack.length).toBeGreaterThan(0);
    for (const e of nullSlack) {
      expect(["UNPLANNED", "ETA_UNAVAILABLE"]).toContain(e.result);
    }
  });
});

// =========================================================================
// planSlots — unit-level tests
// =========================================================================

describe("planSlots", () => {
  it("releases mobile (non-immobile) assignments for replanning", () => {
    const mobileAsg: DispatchAssignmentInputV2 = {
      assignmentId: "mobile-1",
      orderId: "mobile-order",
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      serviceModuleMinutes: 0,
    };

    const orders = [
      makeOrder({ orderId: "mobile-order", executionStatus: "PLANNED" }),
      makeOrder({ orderId: "o2", executionStatus: "UNASSIGNED" }),
    ];

    const drivers = [
      makeDriver({
        driverId: "d1",
        assignments: [mobileAsg],
      }),
      makeDriver({
        driverId: "d2",
      }),
    ];

    const result = planSlots(drivers, drivers, orders, NOW, fixedEtaResolver(10));

    // Both orders should be in the pool (mobile-order released, o2 unassigned)
    // Both should be assignable
    const d1Assignments = result.proposals.get("d1");
    const d2Assignments = result.proposals.get("d2");
    expect(d1Assignments).toBeDefined();
    expect(d2Assignments).toBeDefined();

    // Check no infeasible
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  it("gaps before immobile slots are fillable", () => {
    // Immobile at slot B (WITH a stored departure bound), slot A is empty
    // → should be fillable as long as the new work completes before the
    // driver must depart for B.
    const immobileB: DispatchAssignmentInputV2 = {
      assignmentId: "imm-b",
      orderId: "imm-order-b",
      sequenceNo: 2,
      lockType: "AUTO_FROZEN",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:30:00.000Z",
      plannedCompleteAt: "2026-07-18T09:10:00.000Z",
      serviceModuleMinutes: 0,
    };

    const orders = [
      makeOrder({ orderId: "imm-order-b", executionStatus: "PLANNED" }),
      makeOrder({ orderId: "new-order", executionStatus: "UNASSIGNED" }),
    ];

    const drivers = [
      makeDriver({
        driverId: "d1",
        assignments: [immobileB],
      }),
    ];

    const result = planSlots(drivers, drivers, orders, NOW, fixedEtaResolver(10));

    // new-order should fill slot A, immobile stays at slot B
    const d1 = result.proposals.get("d1")!;
    expect(d1).toHaveLength(2);

    // Slot A (seqNo 1) should be the new order
    const slotA = d1.find((a) => a.sequenceNo === 1)!;
    expect(slotA.orderId).toBe("new-order");

    // Slot B (seqNo 2) should be the immobile order
    const slotB = d1.find((a) => a.sequenceNo === 2)!;
    expect(slotB.orderId).toBe("imm-order-b");
    expect(slotB.assignmentId).toBe("imm-b");
  });
});

// =========================================================================
// Regression tests — P0 / P1 fixes
// =========================================================================

describe("regression: P0/P1 fixes", () => {
  // -----------------------------------------------------------------------
  // P0-1: no fake ETA — absent resolver means "no ETA available"
  // -----------------------------------------------------------------------

  it("P0-1: no etaResolver → all pool orders are ETA-unavailable, no fake plans", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "o1" }),
        makeOrder({ orderId: "o2", promisedPickupAt: "2026-07-18T10:00:00.000Z" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1" }),
        makeDriver({ driverId: "d2" }),
      ],
    };
    // No resolver injected — the core must not fall back to haversine/average
    // speed estimation.
    const result = runDispatchV2(input);
    expect([...evalIds(result.evaluations, "ETA_UNAVAILABLE")].sort()).toEqual(["o1", "o2"]);
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    for (const p of result.proposals) {
      expect(p.assignments).toEqual([]);
    }
  });

  it("P0-1: no etaResolver still respects locked assignments (stored plan kept)", () => {
    const locked: DispatchAssignmentInputV2 = {
      assignmentId: "locked-noeta",
      orderId: "locked-order",
      sequenceNo: 1,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:10:00.000Z",
      plannedCompleteAt: "2026-07-18T08:50:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [locked] })],
    };
    const result = runDispatchV2(input);

    const d1 = result.proposals[0];
    expect(d1.assignments).toHaveLength(1);
    expect(d1.assignments[0].assignmentId).toBe("locked-noeta");
    expect(d1.assignments[0].plannedDepartAt).toBe("2026-07-18T08:10:00.000Z");
    expect(d1.assignments[0].plannedCompleteAt).toBe("2026-07-18T08:50:00.000Z");
    // The input contract carries no pickup time — none may be invented.
    expect(d1.assignments[0].plannedPickupAt).toBeUndefined();
    expect(d1.assignments[0].etaAvailable).toBe(true);
    // The new order cannot be planned without a real ETA source.
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["o1"]);
  });

  // -----------------------------------------------------------------------
  // P0-2: terminal orders never enter the dispatchable pool
  // -----------------------------------------------------------------------

  it("P0-2: CANCELLED / COMPLETED orders don't enter the dispatchable pool", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "cancelled-order", executionStatus: "CANCELLED" }),
        makeOrder({ orderId: "completed-order", executionStatus: "COMPLETED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const assignedOrderIds = result.proposals.flatMap((p) =>
      p.assignments.map((a) => a.orderId)
    );
    expect(assignedOrderIds).toEqual(["o1"]);
    // Terminal orders are silently excluded — they are neither infeasible
    // nor ETA-unavailable, they are simply not dispatchable.
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // P0-3: assignment's OWN execution status governs immobility
  // -----------------------------------------------------------------------

  it("P0-3: EN_ROUTE assignment is immobile even when the order snapshot is missing", () => {
    const enRouteAsg: DispatchAssignmentInputV2 = {
      assignmentId: "enroute-ghost",
      orderId: "ghost-order", // deliberately NOT present in input.orders
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "EN_ROUTE",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:50:00.000Z",
      plannedCompleteAt: "2026-07-18T08:30:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", assignments: [enRouteAsg] })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const d1 = result.proposals[0];
    // The EN_ROUTE assignment stays in slot A; the new order goes to slot B.
    expect(
      d1.assignments.some((a) => a.assignmentId === "enroute-ghost" && a.sequenceNo === 1)
    ).toBe(true);
    expect(d1.assignments.some((a) => a.orderId === "o1" && a.sequenceNo === 2)).toBe(true);
  });

  it("P0-3: COMPLETED assignment is discarded — does NOT occupy a slot (reversed per 1C review 2026-07-19)", () => {
    const completedAsg: DispatchAssignmentInputV2 = {
      assignmentId: "completed-ghost",
      orderId: "ghost-completed-order", // NOT present in input.orders
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "COMPLETED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:30:00.000Z",
      plannedCompleteAt: "2026-07-18T08:10:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", assignments: [completedAsg] })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const d1 = result.proposals[0];
    // The COMPLETED assignment is discarded — it must NOT appear in the proposal.
    expect(d1.assignments.some((a) => a.assignmentId === "completed-ghost")).toBe(false);
    // The freed slot goes to the new order. Cursor starts from the driver's
    // real-time position (lastLocation) at the event time — NOT from the stale
    // completed delivery point / plannedCompleteAt.
    expect(d1.assignments.some((a) => a.orderId === "o1" && a.sequenceNo === 1)).toBe(true);
    const slotA = d1.assignments.find((a) => a.sequenceNo === 1)!;
    expect(slotA.plannedDepartAt).toBe(NOW);
    // Terminal orders are silently excluded — not infeasible, not ETA-unavailable.
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // P1-1: missing service-leg ETA ⇒ etaAvailable=false
  // -----------------------------------------------------------------------

  it("P1-1: etaAvailable=false when the service-leg ETA is missing", () => {
    // Deadhead (driver → pickup) resolves; service leg (pickup → delivery)
    // does not (simulated Amap gap).
    const lookup = new Map<string, number | null>();
    lookup.set(`${PT_HZ_XH.lat},${PT_HZ_XH.lng}->${PT_HZ_XH.lat},${PT_HZ_XH.lng}`, 10);
    const resolver = mapEtaResolver(lookup);

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })], // pickup PT_HZ_XH, delivery PT_GONGSHU
      drivers: [makeDriver({ driverId: "d1" })], // located at PT_HZ_XH
    };
    const result = runDispatchV2(input, resolver);

    const asg = result.proposals[0].assignments[0];
    expect(asg).toBeDefined();
    expect(asg.orderId).toBe("o1");
    expect(asg.etaAvailable).toBe(false);
    expect(asg.etaUnavailableReason).toBe("AMAP_UNAVAILABLE");
    // Incomplete chain — no fabricated completion data.
    expect(asg.plannedCompleteAt).toBeUndefined();
    expect(asg.serviceEtaMinutes).toBeUndefined();
    // The resolvable deadhead leg is still surfaced.
    expect(asg.deadheadEtaMinutes).toBe(10);
  });

  it("P1-1: etaAvailable=false with DESTINATION_MISSING when the order has no delivery location", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", deliveryLocation: undefined })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const asg = result.proposals[0].assignments[0];
    expect(asg).toBeDefined();
    expect(asg.etaAvailable).toBe(false);
    expect(asg.etaUnavailableReason).toBe("DESTINATION_MISSING");
    expect(asg.plannedCompleteAt).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // P1-2: new order in the gap before a locked slot must not overlap it
  // (frozen rule: completeAt <= locked slot's plannedDepartAt)
  // -----------------------------------------------------------------------

  it("P1-2: new order in empty slot A must complete before locked B departs", () => {
    const lockedB: DispatchAssignmentInputV2 = {
      assignmentId: "locked-b",
      orderId: "locked-order-b",
      sequenceNo: 2,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:30:00.000Z",
      plannedCompleteAt: "2026-07-18T09:10:00.000Z",
      serviceModuleMinutes: 0,
    };
    const makeInput = (): DispatchInputV2 => ({
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-b", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "new-order" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedB] })],
    });

    // deadhead 30 + service 30 → would complete 09:00 > locked departure
    // 08:30 → timeline overlap → slot A cannot host the order.
    const overlap = runDispatchV2(makeInput(), fixedEtaResolver(30));
    expect(evalIds(overlap.evaluations, "INFEASIBLE")).toEqual(["new-order"]);
    expect(overlap.proposals[0].assignments.map((a) => a.assignmentId)).toEqual(["locked-b"]);

    // deadhead 10 + service 10 → completes 08:20 <= 08:30 → fits in slot A.
    const fits = runDispatchV2(makeInput(), fixedEtaResolver(10));
    expect(evalIds(fits.evaluations, "INFEASIBLE")).toEqual([]);
    const slotA = fits.proposals[0].assignments.find((a) => a.sequenceNo === 1);
    expect(slotA?.orderId).toBe("new-order");
    expect(slotA?.plannedCompleteAt).toBe("2026-07-18T08:20:00.000Z");

    // Boundary: deadhead 15 + service 15 → completes exactly at the locked
    // departure 08:30 → completeAt <= plannedDepartAt → still allowed.
    const boundary = runDispatchV2(makeInput(), fixedEtaResolver(15));
    expect(evalIds(boundary.evaluations, "INFEASIBLE")).toEqual([]);
    expect(
      boundary.proposals[0].assignments.find((a) => a.sequenceNo === 1)?.orderId
    ).toBe("new-order");
  });

  // -----------------------------------------------------------------------
  // P1-3: locked/executing assignment times are never recalculated
  // -----------------------------------------------------------------------

  it("P1-3: locked assignment keeps its stored plan; the next slot starts after it", () => {
    const lockedA: DispatchAssignmentInputV2 = {
      assignmentId: "locked-a",
      orderId: "locked-order-a",
      sequenceNo: 1,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:00:00.000Z",
      plannedCompleteAt: "2026-07-18T08:45:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-a", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedA] })],
    };
    // A 7-minute resolver would recompute the locked plan as depart 08:00 /
    // complete ~08:14 — the stored plan must win, verbatim.
    const result = runDispatchV2(input, fixedEtaResolver(7));
    const d1 = result.proposals[0];

    const slotA = d1.assignments.find((a) => a.sequenceNo === 1)!;
    expect(slotA.assignmentId).toBe("locked-a");
    expect(slotA.plannedDepartAt).toBe("2026-07-18T08:00:00.000Z");
    expect(slotA.plannedCompleteAt).toBe("2026-07-18T08:45:00.000Z");
    expect(slotA.plannedPickupAt).toBeUndefined();
    expect(slotA.etaAvailable).toBe(true);

    // The next slot's timeline starts from the locked completion time,
    // not from the event time.
    const slotB = d1.assignments.find((a) => a.sequenceNo === 2)!;
    expect(slotB.orderId).toBe("o1");
    expect(slotB.plannedDepartAt).toBe("2026-07-18T08:45:00.000Z");
    expect(slotB.plannedPickupAt).toBe("2026-07-18T08:52:00.000Z");
  });

  // -----------------------------------------------------------------------
  // P1-4: new planned assignments carry serviceEtaMinutes / plannedCompleteAt
  // -----------------------------------------------------------------------

  it("P1-4: new planned assignments carry serviceEtaMinutes and plannedCompleteAt", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", serviceModuleMinutes: 8 })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(12));

    const asg = result.proposals[0].assignments[0];
    expect(asg.etaAvailable).toBe(true);
    expect(asg.deadheadEtaMinutes).toBe(12);
    expect(asg.serviceEtaMinutes).toBe(12);
    expect(asg.plannedDepartAt).toBe(NOW);
    expect(asg.plannedPickupAt).toBe("2026-07-18T08:12:00.000Z");
    // completeAt = pickup + service ETA (12) + service modules (8)
    expect(asg.plannedCompleteAt).toBe("2026-07-18T08:32:00.000Z");
  });
});

// =========================================================================
// Regression tests — frozen plannedDepartAt / immobile-cursor rules
// =========================================================================

describe("regression: plannedDepartAt overlap bound & immobile cursor", () => {
  // -----------------------------------------------------------------------
  // Locked slot WITHOUT plannedDepartAt → earlier empty slots are forbidden
  // -----------------------------------------------------------------------

  it("locked B without plannedDepartAt: the empty slot before it is never filled", () => {
    const lockedB: DispatchAssignmentInputV2 = {
      assignmentId: "locked-nodepart",
      orderId: "locked-order-b",
      sequenceNo: 2,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      // plannedDepartAt deliberately missing — the bound must NOT be
      // inferred from plannedCompleteAt or any ETA computation.
      plannedCompleteAt: "2026-07-18T09:10:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-b", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "new-order", promisedPickupAt: "2026-07-18T09:30:00.000Z" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedB] })],
    };
    // Even a 1-minute ETA everywhere must not squeeze the order in before B.
    const result = runDispatchV2(input, fixedEtaResolver(1));

    const d1 = result.proposals[0];
    expect(d1.assignments.find((a) => a.sequenceNo === 1)).toBeUndefined();
    // The slot AFTER B stays usable — it starts from B's stored completion.
    const slotC = d1.assignments.find((a) => a.sequenceNo === 3);
    expect(slotC?.orderId).toBe("new-order");
    expect(slotC?.plannedDepartAt).toBe("2026-07-18T09:10:00.000Z");
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  it("locked slot without plannedDepartAt forbids ALL earlier empty slots (sole driver → infeasible)", () => {
    const lockedC: DispatchAssignmentInputV2 = {
      assignmentId: "locked-c-nodepart",
      orderId: "locked-order-c",
      sequenceNo: 3,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedCompleteAt: "2026-07-18T10:00:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-c", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "new-order" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedC] })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(1));

    // Slots A and B both precede the bound-less locked slot C → forbidden;
    // the sole driver has no usable capacity → infeasible per existing logic.
    expect(result.proposals[0].assignments.map((a) => a.assignmentId)).toEqual([
      "locked-c-nodepart",
    ]);
    expect(evalIds(result.evaluations, "UNPLANNED")).toEqual(["new-order"]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  it("locked slot without plannedDepartAt: the order stays available for other drivers", () => {
    const lockedC: DispatchAssignmentInputV2 = {
      assignmentId: "locked-c-nodepart",
      orderId: "locked-order-c",
      sequenceNo: 3,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedCompleteAt: "2026-07-18T10:00:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-c", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "new-order" }),
      ],
      drivers: [
        makeDriver({ driverId: "d1", assignments: [lockedC] }),
        makeDriver({ driverId: "d2" }),
      ],
    };
    const result = runDispatchV2(input, fixedEtaResolver(5));

    const d1 = result.proposals.find((p) => p.driverId === "d1")!;
    expect(d1.assignments.map((a) => a.assignmentId)).toEqual(["locked-c-nodepart"]);
    const d2 = result.proposals.find((p) => p.driverId === "d2")!;
    expect(d2.assignments.find((a) => a.sequenceNo === 1)?.orderId).toBe("new-order");
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Immobile WITHOUT plannedCompleteAt → cursor time UNKNOWN downstream
  // -----------------------------------------------------------------------

  it("immobile without plannedCompleteAt: subsequent slots are not planned and times are never recomputed", () => {
    const lockedNoComplete: DispatchAssignmentInputV2 = {
      assignmentId: "locked-nocomplete",
      orderId: "locked-order-a",
      sequenceNo: 1,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:05:00.000Z",
      // plannedCompleteAt deliberately missing → cursor time UNKNOWN
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-a", executionStatus: "PLANNED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedNoComplete] })],
    };
    // A generous resolver is available — it must NOT be used to reconstruct
    // the missing completion time or plan the next slot from it.
    const result = runDispatchV2(input, fixedEtaResolver(5));

    const d1 = result.proposals[0];
    expect(d1.assignments).toHaveLength(1);
    const slotA = d1.assignments[0];
    expect(slotA.assignmentId).toBe("locked-nocomplete");
    // Stored plan echoed verbatim — nothing recomputed, nothing invented.
    expect(slotA.plannedDepartAt).toBe("2026-07-18T08:05:00.000Z");
    expect(slotA.plannedPickupAt).toBeUndefined();
    expect(slotA.plannedCompleteAt).toBeUndefined();
    expect(slotA.etaAvailable).toBe(false);
    // Slots after the unknown-cursor point cannot be planned → data gap.
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual(["o1"]);
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
  });
});

// =========================================================================
// Regression tests — 1C Third Review Rework (2026-07-19)
// =========================================================================

describe("regression: 1C third-review fixes", () => {
  // -----------------------------------------------------------------------
  // R1: orphan EN_ROUTE / IN_SERVICE orders never enter the pool
  // -----------------------------------------------------------------------

  it("R1: orphan EN_ROUTE / IN_SERVICE orders (no assignment) do NOT enter the pool", () => {
    // Orders whose executionStatus is EN_ROUTE or IN_SERVICE but that have
    // no assignment in the snapshot must NOT be (re-)dispatched. They are
    // silently excluded — data inconsistency is not the planner's problem.
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "orphan-enroute", executionStatus: "EN_ROUTE" }),
        makeOrder({ orderId: "orphan-inservice", executionStatus: "IN_SERVICE" }),
        makeOrder({ orderId: "o1", executionStatus: "UNASSIGNED" }),
      ],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const assignedOrderIds = result.proposals.flatMap((p) =>
      p.assignments.map((a) => a.orderId)
    );
    // Only the UNASSIGNED order gets dispatched
    expect(assignedOrderIds).toEqual(["o1"]);
    // Orphan orders are silently excluded — not infeasible, not ETA-unavailable
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // R2: COMPLETED assignment is discarded, slot freed for new order
  //      (reversed assertion vs the old "keeps occupying slot A" test)
  // -----------------------------------------------------------------------

  it("R2: COMPLETED assignment discarded — new order takes slot A from real-time position", () => {
    const completedAsg: DispatchAssignmentInputV2 = {
      assignmentId: "completed-r2",
      orderId: "completed-order-r2",
      sequenceNo: 1,
      lockType: "NONE",
      executionStatus: "COMPLETED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:30:00.000Z",
      plannedCompleteAt: "2026-07-18T08:10:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "completed-order-r2", executionStatus: "COMPLETED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [completedAsg] })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const d1 = result.proposals[0];
    // The COMPLETED assignment must NOT appear (discarded before classification).
    expect(d1.assignments.some((a) => a.assignmentId === "completed-r2")).toBe(false);
    // The new order lands on slot A, departure = event time (real-time position).
    const slotA = d1.assignments.find((a) => a.sequenceNo === 1);
    expect(slotA?.orderId).toBe("o1");
    expect(slotA?.plannedDepartAt).toBe(NOW);
    // The COMPLETED order is not in the pool — not infeasible, not ETA-unavailable.
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // R2b: MANUAL_LOCKED + COMPLETED → still discarded
  //       (lock cannot resurrect a terminal assignment)
  // -----------------------------------------------------------------------

  it("R2b: MANUAL_LOCKED + COMPLETED assignment is still discarded", () => {
    const lockedCompleted: DispatchAssignmentInputV2 = {
      assignmentId: "locked-completed",
      orderId: "locked-completed-order",
      sequenceNo: 1,
      lockType: "MANUAL_LOCKED",
      executionStatus: "COMPLETED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T07:30:00.000Z",
      plannedCompleteAt: "2026-07-18T08:10:00.000Z",
      serviceModuleMinutes: 0,
    };
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-completed-order", executionStatus: "COMPLETED" }),
        makeOrder({ orderId: "o1" }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedCompleted] })],
    };
    const result = runDispatchV2(input, fixedEtaResolver(10));

    const d1 = result.proposals[0];
    // Terminal check precedes lockType — assignment must NOT appear.
    expect(d1.assignments.some((a) => a.assignmentId === "locked-completed")).toBe(false);
    // Freed slot goes to new order.
    expect(d1.assignments.some((a) => a.orderId === "o1" && a.sequenceNo === 1)).toBe(true);
    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // R3: A infeasible (overlaps locked B) but C feasible (after B completes)
  // -----------------------------------------------------------------------

  it("R3: slot A infeasible due to locked B bound, but slot C is feasible", () => {
    // Locked assignment at slot B: departs 08:30, completes 09:10.
    const lockedB: DispatchAssignmentInputV2 = {
      assignmentId: "locked-b",
      orderId: "locked-order-b",
      sequenceNo: 2,
      lockType: "MANUAL_LOCKED",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.32, lng: 120.143 },
      plannedDepartAt: "2026-07-18T08:30:00.000Z",
      plannedCompleteAt: "2026-07-18T09:10:00.000Z",
      serviceModuleMinutes: 0,
    };

    // With a long ETA (30 min), slot A would complete at 09:00 → overlaps 08:30
    // bound → INFEASIBLE. But slot C starts from B's completion (09:10), and
    // with a short deadhead (5 min) the order fits.
    // deadhead 30 + service 30 in slot A: pickup 08:30, complete 09:00 → > 08:30 ×
    // deadhead 5  + service 30 in slot C: starts 09:10, pickup 09:15, complete 09:45
    //   slack = promisedPickupAt(09:00) - 09:15 = -15 ≥ -30 ✓

    const legEta = new Map<string, number | null>();

    // A deadhead: driver position → order pickup (same point) → 30 min (makes A infeasible)
    legEta.set(`${PT_HZ_XH.lat},${PT_HZ_XH.lng}->${PT_HZ_XH.lat},${PT_HZ_XH.lng}`, 30);
    // Service leg: order pickup → order delivery → 30 min
    legEta.set(`${PT_HZ_XH.lat},${PT_HZ_XH.lng}->${PT_GONGSHU.lat},${PT_GONGSHU.lng}`, 30);
    // C deadhead: B's deliveryLocation → order pickup → 5 min (short, fits in C)
    // NOTE: B's deliveryLocation uses hard-coded coords (30.32, 120.143), NOT PT_GONGSHU.
    legEta.set(`30.32,120.143->${PT_HZ_XH.lat},${PT_HZ_XH.lng}`, 5);

    const resolver = mapEtaResolver(legEta);

    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [
        makeOrder({ orderId: "locked-order-b", executionStatus: "PLANNED" }),
        makeOrder({
          orderId: "new-order",
          executionStatus: "UNASSIGNED",
          promisedPickupAt: "2026-07-18T09:00:00.000Z",
        }),
      ],
      drivers: [makeDriver({ driverId: "d1", assignments: [lockedB] })],
    };
    const result = runDispatchV2(input, resolver);

    const d1 = result.proposals[0];
    // Locked assignment stays at slot B.
    expect(d1.assignments.some((a) => a.assignmentId === "locked-b")).toBe(true);

    // New order must land on slot C (seqNo 3), NOT slot A.
    const newAsg = d1.assignments.find((a) => a.orderId === "new-order");
    expect(newAsg).toBeDefined();
    expect(newAsg!.sequenceNo).toBe(3);

    // Cursor for slot C starts at B's plannedCompleteAt (09:10).
    expect(newAsg!.plannedDepartAt).toBe("2026-07-18T09:10:00.000Z");
    // pickup = depart + C deadhead (5) = 09:15; complete = pickup + service ETA (30)
    expect(newAsg!.plannedPickupAt).toBe("2026-07-18T09:15:00.000Z");
    expect(newAsg!.plannedCompleteAt).toBe("2026-07-18T09:45:00.000Z");

    expect(evalIds(result.evaluations, "INFEASIBLE")).toEqual([]);
    expect(evalIds(result.evaluations, "ETA_UNAVAILABLE")).toEqual([]);
  });
});

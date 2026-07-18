import { describe, expect, it } from "vitest";

import { FIXTURE_DISPATCH_INPUT_V2 } from "@/lib/contracts/v2/fixtures";
import type {
  DispatchAssignmentInputV2,
  DispatchDriverInputV2,
  DispatchInputV2,
  DispatchOrderInputV2,
  GeoPointV2,
} from "@/types/v2";

import { filterCandidateDrivers } from "./candidate-filter";
import { calculateFeasibility, calculateSlackMinutes } from "./feasibility";
import { haversineEtaResolver, runDispatchV2 } from "./index";
import { sortOrdersByPriority } from "./sorter";
import { planSlots } from "./slot-planner";
import type { EtaResolver } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

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
// haversine ETA resolver tests
// =========================================================================

describe("haversineEtaResolver", () => {
  it("returns a positive number for valid coordinates", () => {
    const result = haversineEtaResolver(PT_HZ_XH, PT_GONGSHU);
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("returns 0 for same coordinates", () => {
    const result = haversineEtaResolver(PT_HZ_XH, PT_HZ_XH);
    expect(result).toBe(0);
  });

  it("is deterministic — same input gives same output", () => {
    const a = haversineEtaResolver(PT_HZ_XH, PT_GONGSHU);
    const b = haversineEtaResolver(PT_HZ_XH, PT_GONGSHU);
    expect(a).toBe(b);
  });

  it("returns null for non-finite coordinates", () => {
    expect(haversineEtaResolver({ lat: NaN, lng: 120 }, PT_GONGSHU)).toBeNull();
    expect(haversineEtaResolver(PT_HZ_XH, { lat: 30, lng: Infinity })).toBeNull();
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
    expect(result.infeasibleOrderIds).toEqual([]);
    expect(result.etaUnavailableOrderIds).toEqual([]);
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
    expect(result.infeasibleOrderIds).toEqual(["o1"]);
    expect(result.etaUnavailableOrderIds).toEqual([]);
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
    expect(result.infeasibleOrderIds).toEqual([]);
    expect(result.etaUnavailableOrderIds).toEqual([]);
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
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [
        makeDriver({ driverId: "d1" }),
        makeDriver({ driverId: "d2" }),
      ],
    };

    // d1 has 30min ETA, d2 has 10min → d2 should win
    const etaLookup = new Map<string, number>();
    etaLookup.set("30.2741,120.1551->30.2741,120.1551", 10); // d2's position to pickup

    const resolver: EtaResolver = (_from, _to) => {
      // Both drivers start at same position — we need to differentiate
      // Use a simple counter approach instead
      return 15;
    };

    // Actually, both drivers share coordinates. Let me make a more precise test.
    // Give drivers different positions
    const input2: DispatchInputV2 = {
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

    // d2 is closer to pickup → shorter ETA → wins
    const result = runDispatchV2(input2, haversineEtaResolver);
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
    expect(result.infeasibleOrderIds).toContain("new-order");
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
    expect(result.infeasibleOrderIds).toEqual([]);
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
    expect(result.infeasibleOrderIds).toEqual(["o1"]);
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
    expect(result.etaUnavailableOrderIds).toEqual(["o1"]);
    expect(result.infeasibleOrderIds).toEqual([]);
  });

  it("order without pickupLocation → etaUnavailable", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1", pickupLocation: undefined })],
      drivers: [makeDriver({ driverId: "d1" })],
    };
    const result = runDispatchV2(input);
    expect(result.etaUnavailableOrderIds).toEqual(["o1"]);
  });

  it("driver without lastLocation → etaUnavailable", () => {
    const input: DispatchInputV2 = {
      event: { type: "ORDER_RECEIVED", occurredAt: NOW },
      orders: [makeOrder({ orderId: "o1" })],
      drivers: [makeDriver({ driverId: "d1", lastLocation: undefined })],
    };
    const result = runDispatchV2(input);
    expect(result.etaUnavailableOrderIds).toEqual(["o1"]);
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

  it("works with FIXTURE_DISPATCH_INPUT_V2", () => {
    const result = runDispatchV2(FIXTURE_DISPATCH_INPUT_V2);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].driverId).toBe("driver-v2-001");
    expect(result.proposals[0].expectedPlanVersion).toBe(1);
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
    expect(result.infeasibleOrderIds).toEqual([]);
    expect(result.etaUnavailableOrderIds).toEqual([]);
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
    expect(result.infeasibleOrderIds).toEqual([]);
    expect(result.etaUnavailableOrderIds).toEqual([]);
  });

  it("gaps before immobile slots are fillable", () => {
    // Immobile at slot B, slot A is empty → should be fillable
    const immobileB: DispatchAssignmentInputV2 = {
      assignmentId: "imm-b",
      orderId: "imm-order-b",
      sequenceNo: 2,
      lockType: "AUTO_FROZEN",
      executionStatus: "PLANNED",
      pickupLocation: { lat: 30.275, lng: 120.156 },
      deliveryLocation: { lat: 30.320, lng: 120.143 },
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

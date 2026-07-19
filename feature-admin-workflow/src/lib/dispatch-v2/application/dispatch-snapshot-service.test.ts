import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type {
  DispatchableOrderRow,
  DispatchableDriverRow,
  EffectiveAssignmentRow,
} from "../repositories";

import type { DispatchEventV2 } from "@/types/v2/dispatch";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    order: { findUnique: vi.fn() },
    driver: { findUnique: vi.fn() },
    assignment: { findUnique: vi.fn() },
  },
}));

const mockFindDispatchableOrders = vi.fn<(params: {
  storeIds: string[];
  orderIds?: string[];
}) => Promise<DispatchableOrderRow[]>>();

const mockFindDispatchableDrivers = vi.fn<(params: {
  storeIds: string[];
  driverIds?: string[];
}) => Promise<DispatchableDriverRow[]>>();

const mockFindEffectiveAssignments = vi.fn<(params: {
  driverIds: string[];
}) => Promise<EffectiveAssignmentRow[]>>();

const mockFindServicePlans = vi.fn<(params: {
  assignmentIds: string[];
}) => Promise<{ assignmentId: string; totalModuleMinutes: number }[]>>();

vi.mock("../repositories", () => ({
  findDispatchableOrders: (...args: unknown[]) =>
    mockFindDispatchableOrders(...args),
  findDispatchableDrivers: (...args: unknown[]) =>
    mockFindDispatchableDrivers(...args),
  findEffectiveAssignments: (...args: unknown[]) =>
    mockFindEffectiveAssignments(...args),
  findServicePlans: (...args: unknown[]) =>
    mockFindServicePlans(...args),
}));

import { buildDispatchSnapshot } from "./dispatch-snapshot-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Clock & helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-19T08:00:00.000Z");
const NOW_MS = NOW.getTime();
const NOW_ISO = NOW.toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function mockStoreLookup(storeIds: string[]) {
  vi.mocked(prisma.store.findMany).mockResolvedValue(
    storeIds.map((id) => ({ id })) as never
  );
}

function makeOrderRow(
  overrides: Partial<DispatchableOrderRow> = {}
): DispatchableOrderRow {
  return {
    id: "order-1",
    orderNo: "ORD-001",
    type: "STORE_PICKUP",
    executionStatus: "UNASSIGNED",
    feasibility: "UNKNOWN",
    slackMinutes: null,
    promisedPickupAt: new Date("2026-07-19T09:00:00.000Z"),
    pickupAddress: "123 Main St",
    pickupLat: 30.2741,
    pickupLng: 120.1551,
    deliveryAddress: "456 Oak Ave",
    deliveryLat: 30.32,
    deliveryLng: 120.143,
    storeCode: "STORE-A",
    currentAssignmentId: null,
    ...overrides,
  };
}

function makeDriverRow(
  overrides: Partial<DispatchableDriverRow> = {}
): DispatchableDriverRow {
  return {
    id: "driver-1",
    storeCode: "STORE-A",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 1,
    lastLat: 30.28,
    lastLng: 120.16,
    lastAccuracyMeters: 10,
    lastLocationCapturedAt: new Date(NOW_MS - 60_000), // 1 min ago → FRESH
    ...overrides,
  };
}

function makeAssignmentRow(
  overrides: Partial<EffectiveAssignmentRow> = {}
): EffectiveAssignmentRow {
  return {
    id: "asg-1",
    orderId: "order-1",
    driverId: "driver-1",
    type: "MANUAL_ASSIGN",
    status: "ACTIVE",
    sequenceNo: 1,
    lockType: "NONE",
    plannedDepartAt: new Date("2026-07-19T08:15:00.000Z"),
    plannedCompleteAt: new Date("2026-07-19T08:55:00.000Z"),
    orderExecutionStatus: "PLANNED",
    pickupLat: 30.2741,
    pickupLng: 120.1551,
    deliveryLat: 30.32,
    deliveryLng: 120.143,
    ...overrides,
  };
}

const ORDER_RECEIVED: DispatchEventV2 = {
  type: "ORDER_RECEIVED",
  occurredAt: NOW_ISO,
  orderId: "new-order",
};

const BASELINE: DispatchEventV2 = {
  type: "BASELINE_RECALCULATION",
  occurredAt: NOW_ISO,
};

// ===========================================================================
// P0-1: Driver timeline integrity
// ===========================================================================

describe("P0-1: driver timeline integrity", () => {
  it("new order event loads ALL effective assignments for every driver in scope", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    // Driver d1 has a locked slot A (order-X) and EN_ROUTE slot B (order-Y).
    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "new-order", executionStatus: "UNASSIGNED" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({
        id: "asg-locked",
        orderId: "order-x",
        driverId: "driver-1",
        sequenceNo: 1,
        lockType: "MANUAL_LOCKED",
        orderExecutionStatus: "PLANNED",
        plannedDepartAt: new Date("2026-07-19T08:00:00.000Z"),
        plannedCompleteAt: new Date("2026-07-19T08:40:00.000Z"),
      }),
      makeAssignmentRow({
        id: "asg-enroute",
        orderId: "order-y",
        driverId: "driver-1",
        sequenceNo: 2,
        lockType: "NONE",
        orderExecutionStatus: "EN_ROUTE",
      }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);

    // P0-1 fix: the snapshot MUST carry both assignments so the core sees
    // that slots A and B are occupied.
    expect(snapshot.drivers).toHaveLength(1);
    expect(snapshot.drivers[0].assignments).toHaveLength(2);
    const seqNos = snapshot.drivers[0].assignments.map((a) => a.sequenceNo);
    expect(seqNos).toContain(1);
    expect(seqNos).toContain(2);

    // The repo must NOT receive an orderIds filter (the core fix).
    const callArgs = mockFindEffectiveAssignments.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("orderIds");
    expect(callArgs).toHaveProperty("driverIds");
  });

  it("new unassigned order with driver holding EN_ROUTE + IN_SERVICE: full timeline preserved", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    // Driver d1 has assignments for 3 different orders in A/B/C.
    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "new-order", executionStatus: "UNASSIGNED" }),
      makeOrderRow({ id: "order-a", executionStatus: "EN_ROUTE" }),
      makeOrderRow({ id: "order-b", executionStatus: "IN_SERVICE" }),
      makeOrderRow({ id: "order-c", executionStatus: "PLANNED" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({
        id: "asg-a", orderId: "order-a", driverId: "driver-1",
        sequenceNo: 1, lockType: "NONE", orderExecutionStatus: "EN_ROUTE",
      }),
      makeAssignmentRow({
        id: "asg-b", orderId: "order-b", driverId: "driver-1",
        sequenceNo: 2, lockType: "NONE", orderExecutionStatus: "IN_SERVICE",
      }),
      makeAssignmentRow({
        id: "asg-c", orderId: "order-c", driverId: "driver-1",
        sequenceNo: 3, lockType: "NONE", orderExecutionStatus: "PLANNED",
      }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);

    // All 3 assignments must be in the snapshot — the core needs the full
    // timeline to know A/B/C are occupied.
    expect(snapshot.drivers[0].assignments).toHaveLength(3);
    const seqNos = snapshot.drivers[0].assignments.map((a) => a.sequenceNo);
    expect(seqNos.sort()).toEqual([1, 2, 3]);
    expect(snapshot.drivers[0].assignments.map((a) => a.executionStatus)).toEqual(
      expect.arrayContaining(["EN_ROUTE", "IN_SERVICE", "PLANNED"])
    );
  });
});

// ===========================================================================
// P0-2: Location freshness (120 s threshold)
// ===========================================================================

describe("P0-2: location freshness 120 s threshold", () => {
  it("120 s old location is FRESH (boundary)", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    const capturedAt = new Date(NOW_MS - 120_000); // exactly 120 s
    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLocationCapturedAt: capturedAt }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].locationFreshness).toBe("FRESH");
  });

  it("120 001 ms old location is STALE (boundary + 1 ms)", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    const capturedAt = new Date(NOW_MS - 120_001); // 120 s + 1 ms
    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLocationCapturedAt: capturedAt }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].locationFreshness).toBe("STALE");
  });

  it("null capturedAt → NONE", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLocationCapturedAt: null }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].locationFreshness).toBe("NONE");
  });

  it("missing lat → entire lastLocation is undefined", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLat: null }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].lastLocation).toBeUndefined();
    // Freshness still computed from capturedAt even if location omitted.
    expect(snapshot.drivers[0].locationFreshness).toBe("FRESH");
  });

  it("missing lng → entire lastLocation is undefined", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLng: null }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].lastLocation).toBeUndefined();
  });

  it("missing accuracyMeters → entire lastLocation is undefined", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastAccuracyMeters: null }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].lastLocation).toBeUndefined();
  });

  it("missing capturedAt → entire lastLocation is undefined", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLocationCapturedAt: null }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].lastLocation).toBeUndefined();
    expect(snapshot.drivers[0].locationFreshness).toBe("NONE");
  });
});

// ===========================================================================
// P1-1: null sequenceNo → hard throw
// ===========================================================================

describe("P1-1: sequenceNo validation", () => {
  it("null sequenceNo throws", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ sequenceNo: null }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    await expect(
      buildDispatchSnapshot(ORDER_RECEIVED)
    ).rejects.toThrow("Invalid assignment sequenceNo: null");
  });

  it("sequenceNo 0 (out of 1-3 range) throws", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ sequenceNo: 0 }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    await expect(
      buildDispatchSnapshot(ORDER_RECEIVED)
    ).rejects.toThrow("Invalid assignment sequenceNo: 0");
  });

  it("sequenceNo 1, 2, 3 are all accepted", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ id: "a1", orderId: "o1", sequenceNo: 1 }),
      makeAssignmentRow({ id: "a2", orderId: "o2", sequenceNo: 2 }),
      makeAssignmentRow({ id: "a3", orderId: "o3", sequenceNo: 3 }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.drivers[0].assignments).toHaveLength(3);
  });
});

// ===========================================================================
// Order & driver mapping
// ===========================================================================

describe("order mapping", () => {
  it("maps a dispatchable order with coordinates", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);

    expect(snapshot.orders).toHaveLength(1);
    const o = snapshot.orders[0];
    expect(o.orderId).toBe("order-1");
    expect(o.businessType).toBe("STORE_PICKUP");
    expect(o.executionStatus).toBe("UNASSIGNED");
    expect(o.pickupLocation).toEqual({ lat: 30.2741, lng: 120.1551 });
    expect(o.serviceModuleMinutes).toBe(0);
  });

  it("COMPLETED and CANCELLED orders are excluded by DB filter", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    // Repository already filters these — the test verifies the snapshot
    // only sees what the repository returns.
    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "o1", executionStatus: "UNASSIGNED" }),
      makeOrderRow({ id: "o2", executionStatus: "PLANNED" }),
      makeOrderRow({ id: "o3", executionStatus: "EN_ROUTE" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    expect(snapshot.orders).toHaveLength(3);
    const statuses = snapshot.orders.map((o) => o.executionStatus);
    expect(statuses).not.toContain("COMPLETED");
    expect(statuses).not.toContain("CANCELLED");
  });
});

// ===========================================================================
// Driver mapping
// ===========================================================================

describe("driver mapping", () => {
  it("maps driver with fresh location", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED);
    const d = snapshot.drivers[0];
    expect(d.driverId).toBe("driver-1");
    expect(d.onShift).toBe(true);
    expect(d.locationFreshness).toBe("FRESH");
    expect(d.lastLocation?.lat).toBe(30.28);
  });
});

// ===========================================================================
// Determinism & read-only
// ===========================================================================

describe("determinism", () => {
  it("produces identical snapshots for the same fixtures", async () => {
    mockStoreLookup(["store-1"]);
    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([makeAssignmentRow()]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-1", totalModuleMinutes: 25 },
    ]);

    const s1 = await buildDispatchSnapshot(BASELINE);
    const s2 = await buildDispatchSnapshot(BASELINE);

    expect(s1).toEqual(s2);
  });

  it("no N+1 — each repository called exactly once", async () => {
    mockStoreLookup(["store-1"]);
    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([makeAssignmentRow()]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-1", totalModuleMinutes: 25 },
    ]);

    await buildDispatchSnapshot(BASELINE);

    expect(mockFindDispatchableOrders).toHaveBeenCalledTimes(1);
    expect(mockFindDispatchableDrivers).toHaveBeenCalledTimes(1);
    expect(mockFindEffectiveAssignments).toHaveBeenCalledTimes(1);
    expect(mockFindServicePlans).toHaveBeenCalledTimes(1);
  });
});

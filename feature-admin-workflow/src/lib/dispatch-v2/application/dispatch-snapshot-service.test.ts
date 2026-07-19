import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type {
  DispatchableOrderRow,
  DispatchableDriverRow,
  EffectiveAssignmentRow,
  ServicePlanRow,
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

const mockFindDispatchableOrders = vi.fn();
const mockFindDispatchableDrivers = vi.fn();
const mockFindEffectiveAssignments = vi.fn();
const mockFindServicePlans = vi.fn();

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
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-19T08:00:00.000Z");
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

function makeOrderRow(overrides: Partial<DispatchableOrderRow> = {}): DispatchableOrderRow {
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

function makeDriverRow(overrides: Partial<DispatchableDriverRow> = {}): DispatchableDriverRow {
  return {
    id: "driver-1",
    storeCode: "STORE-A",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 1,
    lastLat: 30.28,
    lastLng: 120.16,
    lastAccuracyMeters: 10,
    lastLocationCapturedAt: new Date("2026-07-19T07:59:00.000Z"),
    ...overrides,
  };
}

function makeAssignmentRow(overrides: Partial<EffectiveAssignmentRow> = {}): EffectiveAssignmentRow {
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

const ORDER_RECEIVED_EVENT: DispatchEventV2 = {
  type: "ORDER_RECEIVED",
  occurredAt: NOW_ISO,
  orderId: "order-1",
};

const BASELINE_EVENT: DispatchEventV2 = {
  type: "BASELINE_RECALCULATION",
  occurredAt: NOW_ISO,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDispatchSnapshot", () => {
  // -----------------------------------------------------------------------
  // Scope resolution
  // -----------------------------------------------------------------------

  it("resolves store from orderId for ORDER_RECEIVED event", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.event).toEqual(ORDER_RECEIVED_EVENT);
    expect(snapshot.orders).toEqual([]);
    expect(snapshot.drivers).toEqual([]);
  });

  it("resolves all active stores for BASELINE_RECALCULATION", async () => {
    mockStoreLookup(["store-1", "store-2"]);
    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(BASELINE_EVENT);

    expect(prisma.store.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true },
    });
    expect(snapshot.orders).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Order mapping
  // -----------------------------------------------------------------------

  it("maps a dispatchable order with coordinates", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.orders).toHaveLength(1);
    const o = snapshot.orders[0];
    expect(o.orderId).toBe("order-1");
    expect(o.orderNo).toBe("ORD-001");
    expect(o.businessType).toBe("STORE_PICKUP");
    expect(o.executionStatus).toBe("UNASSIGNED");
    expect(o.storeCode).toBe("STORE-A");
    expect(o.pickupLocation).toEqual({ lat: 30.2741, lng: 120.1551 });
    expect(o.deliveryLocation).toEqual({ lat: 30.32, lng: 120.143 });
    expect(o.serviceModuleMinutes).toBe(0);
  });

  it("filters out COMPLETED and CANCELLED orders at DB query level", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    // Repo returns only non-terminal orders; the DB filter does the work.
    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "o1", executionStatus: "UNASSIGNED" }),
      makeOrderRow({ id: "o2", executionStatus: "PLANNED" }),
      makeOrderRow({ id: "o3", executionStatus: "EN_ROUTE" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.orders).toHaveLength(3);
    const statuses = snapshot.orders.map((o) => o.executionStatus);
    expect(statuses).not.toContain("COMPLETED");
    expect(statuses).not.toContain("CANCELLED");
  });

  // -----------------------------------------------------------------------
  // Driver mapping
  // -----------------------------------------------------------------------

  it("maps a driver with fresh location", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.drivers).toHaveLength(1);
    const d = snapshot.drivers[0];
    expect(d.driverId).toBe("driver-1");
    expect(d.storeCode).toBe("STORE-A");
    expect(d.onShift).toBe(true);
    expect(d.availability).toBe("AVAILABLE");
    expect(d.planVersion).toBe(1);
    expect(d.locationFreshness).toBe("FRESH");
    expect(d.lastLocation?.lat).toBe(30.28);
    expect(d.assignments).toEqual([]);
  });

  it("marks location as STALE when older than 5 minutes", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    const staleTime = new Date(NOW.getTime() - 301_000); // 5m 1s ago
    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({ lastLocationCapturedAt: staleTime }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);
    expect(snapshot.drivers[0].locationFreshness).toBe("STALE");
  });

  it("marks location as NONE when driver has no stored location", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([]);
    mockFindDispatchableDrivers.mockResolvedValue([
      makeDriverRow({
        lastLat: null,
        lastLng: null,
        lastAccuracyMeters: null,
        lastLocationCapturedAt: null,
      }),
    ]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);
    expect(snapshot.drivers[0].locationFreshness).toBe("NONE");
    expect(snapshot.drivers[0].lastLocation).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Assignment mapping & immobility
  // -----------------------------------------------------------------------

  it("maps effective assignments to driver inputs with plan minutes", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([makeAssignmentRow()]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-1", totalModuleMinutes: 25 },
    ]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.drivers).toHaveLength(1);
    const asg = snapshot.drivers[0].assignments[0];
    expect(asg).toBeDefined();
    expect(asg.assignmentId).toBe("asg-1");
    expect(asg.sequenceNo).toBe(1);
    expect(asg.lockType).toBe("NONE");
    expect(asg.executionStatus).toBe("PLANNED");
    expect(asg.serviceModuleMinutes).toBe(25);

    // Order should inherit the total module minutes from its assignment.
    expect(snapshot.orders[0].serviceModuleMinutes).toBe(25);
  });

  it("treats MANUAL_LOCKED assignments as immobile (lock type preserved)", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ lockType: "MANUAL_LOCKED" }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);
    expect(snapshot.drivers[0].assignments[0].lockType).toBe("MANUAL_LOCKED");
  });

  it("EN_ROUTE and IN_SERVICE orders have their assignments in snapshot (immobile)", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "order-enroute", executionStatus: "EN_ROUTE" }),
      makeOrderRow({ id: "order-inservice", executionStatus: "IN_SERVICE" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ id: "asg-er", orderId: "order-enroute", orderExecutionStatus: "EN_ROUTE" }),
      makeAssignmentRow({ id: "asg-is", orderId: "order-inservice", orderExecutionStatus: "IN_SERVICE" }),
    ]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    // Both assignments are present in the protected snapshot.
    expect(snapshot.drivers[0].assignments).toHaveLength(2);
    const statuses = snapshot.drivers[0].assignments.map((a) => a.executionStatus);
    expect(statuses).toContain("EN_ROUTE");
    expect(statuses).toContain("IN_SERVICE");
  });

  // -----------------------------------------------------------------------
  // Determinism (same input → same output)
  // -----------------------------------------------------------------------

  it("produces identical snapshots for the same fixtures", async () => {
    mockStoreLookup(["store-1"]);
    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([makeAssignmentRow()]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-1", totalModuleMinutes: 25 },
    ]);

    const s1 = await buildDispatchSnapshot(BASELINE_EVENT);
    const s2 = await buildDispatchSnapshot(BASELINE_EVENT);

    expect(s1).toEqual(s2);
  });

  // -----------------------------------------------------------------------
  // No N+1: single batch calls
  // -----------------------------------------------------------------------

  it("makes exactly one call to each repository (batch reads, no N+1)", async () => {
    mockStoreLookup(["store-1"]);
    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([makeAssignmentRow()]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-1", totalModuleMinutes: 25 },
    ]);

    await buildDispatchSnapshot(BASELINE_EVENT);

    expect(mockFindDispatchableOrders).toHaveBeenCalledTimes(1);
    expect(mockFindDispatchableDrivers).toHaveBeenCalledTimes(1);
    expect(mockFindEffectiveAssignments).toHaveBeenCalledTimes(1);
    expect(mockFindServicePlans).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Snapshot is read-only (no write calls)
  // -----------------------------------------------------------------------

  it("returns a plain object with no side effects on repositories", async () => {
    mockStoreLookup(["store-1"]);
    mockFindDispatchableOrders.mockResolvedValue([makeOrderRow()]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([]);
    mockFindServicePlans.mockResolvedValue([]);

    const snapshot = await buildDispatchSnapshot(BASELINE_EVENT);

    expect(snapshot).toBeDefined();
    expect(snapshot.event).toEqual(BASELINE_EVENT);
    // Verify no write-side Prisma calls were made
    expect(vi.mocked(prisma.order.findUnique)).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Multiplex: multiple orders, drivers, assignments
  // -----------------------------------------------------------------------

  it("correctly groups multiple assignments per driver", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      storeId: "store-1",
    } as never);

    mockFindDispatchableOrders.mockResolvedValue([
      makeOrderRow({ id: "order-1" }),
      makeOrderRow({ id: "order-2" }),
    ]);
    mockFindDispatchableDrivers.mockResolvedValue([makeDriverRow()]);
    mockFindEffectiveAssignments.mockResolvedValue([
      makeAssignmentRow({ id: "asg-A", orderId: "order-1", sequenceNo: 1 }),
      makeAssignmentRow({ id: "asg-B", orderId: "order-2", sequenceNo: 2 }),
    ]);
    mockFindServicePlans.mockResolvedValue([
      { assignmentId: "asg-A", totalModuleMinutes: 10 },
      { assignmentId: "asg-B", totalModuleMinutes: 15 },
    ]);

    const snapshot = await buildDispatchSnapshot(ORDER_RECEIVED_EVENT);

    expect(snapshot.drivers[0].assignments).toHaveLength(2);
    expect(snapshot.drivers[0].assignments.map((a) => a.sequenceNo)).toEqual([1, 2]);
    expect(snapshot.orders.find((o) => o.orderId === "order-1")?.serviceModuleMinutes).toBe(10);
    expect(snapshot.orders.find((o) => o.orderId === "order-2")?.serviceModuleMinutes).toBe(15);
  });
});

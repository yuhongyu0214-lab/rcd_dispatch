import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prisma at the module level — use vi.hoisted so the mock factories
// are available before the mocked module is imported by the repos.
// ---------------------------------------------------------------------------

const {
  mockOrderFindMany,
  mockDriverFindMany,
  mockAssignmentFindMany,
  mockServicePlanFindMany,
} = vi.hoisted(() => ({
  mockOrderFindMany: vi.fn(),
  mockDriverFindMany: vi.fn(),
  mockAssignmentFindMany: vi.fn(),
  mockServicePlanFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: mockOrderFindMany },
    driver: { findMany: mockDriverFindMany },
    assignment: { findMany: mockAssignmentFindMany },
    orderServicePlan: { findMany: mockServicePlanFindMany },
  },
}));

import { findDispatchableOrders } from "./dispatch-order-repo";
import { findDispatchableDrivers } from "./dispatch-driver-repo";
import { findEffectiveAssignments } from "./dispatch-assignment-repo";
import { findServicePlans } from "./dispatch-service-plan-repo";

beforeEach(() => {
  vi.clearAllMocks();
  mockOrderFindMany.mockResolvedValue([]);
  mockDriverFindMany.mockResolvedValue([]);
  mockAssignmentFindMany.mockResolvedValue([]);
  mockServicePlanFindMany.mockResolvedValue([]);
});

// ===========================================================================
// findDispatchableOrders — terminal status exclusion
// ===========================================================================

describe("findDispatchableOrders", () => {
  it("passes notIn [COMPLETED, CANCELLED] to Prisma where clause", async () => {
    await findDispatchableOrders({ storeIds: ["s1"] });

    expect(mockOrderFindMany).toHaveBeenCalledTimes(1);
    const call = mockOrderFindMany.mock.calls[0][0];
    expect(call.where.executionStatus).toEqual({
      notIn: ["COMPLETED", "CANCELLED"],
    });
    expect(call.where.storeId).toEqual({ in: ["s1"] });
  });

  it("sorts by promisedPickupAt asc then id asc for deterministic output", async () => {
    await findDispatchableOrders({ storeIds: ["s1"] });

    const call = mockOrderFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([
      { promisedPickupAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("returns empty array for empty storeIds AND empty requiredOrderIds", async () => {
    const result = await findDispatchableOrders({ storeIds: [] });
    expect(result).toEqual([]);
    expect(mockOrderFindMany).not.toHaveBeenCalled();
  });

  it("uses OR union when requiredOrderIds are provided alongside storeIds", async () => {
    await findDispatchableOrders({
      storeIds: ["s1"],
      requiredOrderIds: ["order-z"],
    });

    expect(mockOrderFindMany).toHaveBeenCalledTimes(1);
    const call = mockOrderFindMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { storeId: { in: ["s1"] } },
        { id: { in: ["order-z"] } },
      ])
    );
  });

  it("queries by requiredOrderIds alone when storeIds is empty", async () => {
    await findDispatchableOrders({
      storeIds: [],
      requiredOrderIds: ["order-z", "order-y"],
    });

    expect(mockOrderFindMany).toHaveBeenCalledTimes(1);
    const call = mockOrderFindMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ in: ["order-z", "order-y"] });
    expect(call.where).not.toHaveProperty("OR");
  });
});

// ===========================================================================
// findDispatchableDrivers — stable sort
// ===========================================================================

describe("findDispatchableDrivers", () => {
  it("sorts by id ascending for deterministic output", async () => {
    await findDispatchableDrivers({ storeIds: ["s1"] });

    const call = mockDriverFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ id: "asc" });
  });

  it("returns empty array for empty storeIds", async () => {
    const result = await findDispatchableDrivers({ storeIds: [] });
    expect(result).toEqual([]);
    expect(mockDriverFindMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// findEffectiveAssignments — status filter & stable sort
// ===========================================================================

describe("findEffectiveAssignments", () => {
  it("passes status in [ACTIVE, ACCEPTED] to Prisma where", async () => {
    await findEffectiveAssignments({ driverIds: ["d1"] });

    const call = mockAssignmentFindMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ["ACTIVE", "ACCEPTED"] });
  });

  it("filters out terminal order execution statuses", async () => {
    await findEffectiveAssignments({ driverIds: ["d1"] });

    const call = mockAssignmentFindMany.mock.calls[0][0];
    expect(call.where.order.executionStatus).toEqual({
      notIn: ["COMPLETED", "CANCELLED"],
    });
  });

  it("sorts by driverId then sequenceNo for deterministic output", async () => {
    await findEffectiveAssignments({ driverIds: ["d1", "d2"] });

    const call = mockAssignmentFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([
      { driverId: "asc" },
      { sequenceNo: "asc" },
    ]);
  });

  it("returns empty array for empty driverIds", async () => {
    const result = await findEffectiveAssignments({ driverIds: [] });
    expect(result).toEqual([]);
    expect(mockAssignmentFindMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// findServicePlans — stable sort
// ===========================================================================

describe("findServicePlans", () => {
  it("sorts by assignmentId ascending for deterministic output", async () => {
    await findServicePlans({ assignmentIds: ["a1"] });

    const call = mockServicePlanFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ assignmentId: "asc" });
  });

  it("returns empty array for empty assignmentIds", async () => {
    const result = await findServicePlans({ assignmentIds: [] });
    expect(result).toEqual([]);
    expect(mockServicePlanFindMany).not.toHaveBeenCalled();
  });
});

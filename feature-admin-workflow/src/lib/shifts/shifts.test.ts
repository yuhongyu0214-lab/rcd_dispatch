import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mock setup
// ============================================================================

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    driverShift: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    assignment: {
      findMany: vi.fn(),
      update: vi.fn()
    },
    order: {
      update: vi.fn()
    }
  }
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { prisma } from "@/lib/prisma";

import { endShift, getActivePlannedAssignments, startShift } from "./shift-service";

// ============================================================================
// Helpers
// ============================================================================

function mockDriver(props: { onShift: boolean; isActive?: boolean }) {
  vi.mocked(prisma.driver.findUnique).mockResolvedValue({
    id: "d-1",
    onShift: props.onShift,
    isActive: props.isActive ?? true
  } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);
}

function mockShift(overrides: { endedAt?: Date | null } = {}) {
  const shift = {
    id: "shift-1",
    driverId: "d-1",
    startedAt: new Date(),
    endedAt: overrides.endedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  return shift;
}

// ============================================================================
// startShift
// ============================================================================

describe("startShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a shift and sets driver onShift=true, availability=AVAILABLE", async () => {
    mockDriver({ onShift: false });
    vi.mocked(prisma.driverShift.create).mockResolvedValue(mockShift());
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.driverId).toBe("d-1");
    expect(prisma.driverShift.create).toHaveBeenCalledTimes(1);
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { onShift: true, availability: "AVAILABLE" }
    });
  });

  it("returns NOT_FOUND when driver does not exist", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when driver is inactive", async () => {
    mockDriver({ onShift: false, isActive: false });

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("is idempotent — returns existing active shift when already onShift", async () => {
    mockDriver({ onShift: true });
    const existingShift = mockShift();
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(existingShift);

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.id).toBe("shift-1");
    // Should NOT create a new shift
    expect(prisma.driverShift.create).not.toHaveBeenCalled();
    expect(prisma.driver.update).not.toHaveBeenCalled();
  });

  it("repairs state when onShift=true but no active shift row exists", async () => {
    mockDriver({ onShift: true });
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.driverShift.create).mockResolvedValue(mockShift());

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    // Should create a shift to repair the state
    expect(prisma.driverShift.create).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// endShift
// ============================================================================

describe("endShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes shift and sets onShift=false on clean end (no active orders)", async () => {
    mockDriver({ onShift: true });
    // No blocking assignments
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.assignment.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.assignment.update>>);
    vi.mocked(prisma.order.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.order.update>>);
    const activeShift = mockShift();
    const closedShift = { ...activeShift, endedAt: new Date() };
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(activeShift);
    vi.mocked(prisma.driverShift.update).mockResolvedValue(closedShift);
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.endedAt).not.toBeNull();
    expect(prisma.driverShift.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shift-1" },
        data: { endedAt: expect.any(Date) as Date }
      })
    );
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { onShift: false }
    });
  });

  it("returns NOT_FOUND when driver does not exist", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns ILLEGAL_TRANSITION when driver is not on shift", async () => {
    mockDriver({ onShift: false });

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("returns ILLEGAL_TRANSITION when driver has EN_ROUTE order", async () => {
    mockDriver({ onShift: true });

    // First call: blocking assignments check
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      { id: "a-1", orderId: "o-1" }
    ] as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    expect(result.error.message).toContain("EN_ROUTE or IN_SERVICE");
  });

  it("returns ILLEGAL_TRANSITION when driver has IN_SERVICE order", async () => {
    mockDriver({ onShift: true });

    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      { id: "a-1", orderId: "o-1" }
    ] as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("releases PLANNED assignments on end shift", async () => {
    mockDriver({ onShift: true });

    // First findMany: blocking assignments → empty (no EN_ROUTE/IN_SERVICE)
    // Second findMany: planned assignments
    vi.mocked(prisma.assignment.findMany)
      .mockResolvedValueOnce([]) // blocking
      .mockResolvedValueOnce([
        { id: "a-1", orderId: "o-1" },
        { id: "a-2", orderId: "o-2" }
      ] as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>);

    vi.mocked(prisma.assignment.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.assignment.update>>);
    vi.mocked(prisma.order.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.order.update>>);

    const activeShift = mockShift();
    const closedShift = { ...activeShift, endedAt: new Date() };
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(activeShift);
    vi.mocked(prisma.driverShift.update).mockResolvedValue(closedShift);
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    // Both assignments should be released
    expect(prisma.assignment.update).toHaveBeenCalledTimes(2);
    expect(prisma.order.update).toHaveBeenCalledTimes(2);
    // Release a-1
    expect(prisma.assignment.update).toHaveBeenCalledWith({
      where: { id: "a-1" },
      data: { sequenceNo: null }
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "o-1" },
      data: { executionStatus: "UNASSIGNED" }
    });
    // Release a-2
    expect(prisma.assignment.update).toHaveBeenCalledWith({
      where: { id: "a-2" },
      data: { sequenceNo: null }
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "o-2" },
      data: { executionStatus: "UNASSIGNED" }
    });
  });

  it("does NOT release EN_ROUTE/IN_SERVICE assignments when PLANNED ones exist", async () => {
    mockDriver({ onShift: true });

    // First findMany: blocking → empty (we'll test the guard separately)
    // Second findMany: only PLANNED assignments
    vi.mocked(prisma.assignment.findMany)
      .mockResolvedValueOnce([]) // blocking check passes
      .mockResolvedValueOnce([
        { id: "a-1", orderId: "o-1" }
      ] as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>);

    vi.mocked(prisma.assignment.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.assignment.update>>);
    vi.mocked(prisma.order.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.order.update>>);

    const activeShift = mockShift();
    const closedShift = { ...activeShift, endedAt: new Date() };
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(activeShift);
    vi.mocked(prisma.driverShift.update).mockResolvedValue(closedShift);
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    // Only planned assignments are released
    expect(prisma.assignment.update).toHaveBeenCalledTimes(1);
    expect(prisma.order.update).toHaveBeenCalledTimes(1);
  });

  it("handles edge case where onShift=true but no open shift row", async () => {
    mockDriver({ onShift: true });
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");
    // Should still clean up the driver state
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { onShift: false }
    });
  });

  it("does NOT block when there are no PLANNED orders either", async () => {
    mockDriver({ onShift: true });

    vi.mocked(prisma.assignment.findMany)
      .mockResolvedValueOnce([]) // no blocking
      .mockResolvedValueOnce([]); // no planned

    const activeShift = mockShift();
    const closedShift = { ...activeShift, endedAt: new Date() };
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(activeShift);
    vi.mocked(prisma.driverShift.update).mockResolvedValue(closedShift);
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    // No assignment or order updates needed
    expect(prisma.assignment.update).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getActivePlannedAssignments
// ============================================================================

describe("getActivePlannedAssignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns PLANNED assignments for the driver", async () => {
    const assignments = [
      { id: "a-1", driverId: "d-1", orderId: "o-1", status: "ACTIVE" }
    ];
    vi.mocked(prisma.assignment.findMany).mockResolvedValue(
      assignments as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>
    );

    const result = await getActivePlannedAssignments("d-1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a-1");
    expect(prisma.assignment.findMany).toHaveBeenCalledWith({
      where: {
        driverId: "d-1",
        status: "ACTIVE",
        order: { executionStatus: "PLANNED" }
      },
      include: { order: true }
    });
  });

  it("returns empty array when no PLANNED assignments", async () => {
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);

    const result = await getActivePlannedAssignments("d-1");

    expect(result).toHaveLength(0);
  });
});

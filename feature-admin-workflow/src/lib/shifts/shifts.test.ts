import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mock setup
// ============================================================================

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    driver: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
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
    },
    operationLog: {
      create: vi.fn()
    },
    user: {
      findFirst: vi.fn()
    }
  }
}));

vi.mock("@/lib/redis", () => ({
  acquireDispatchLock: vi.fn(),
  releaseDispatchLock: vi.fn()
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { acquireDispatchLock, releaseDispatchLock } from "@/lib/redis";
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
  return {
    id: "shift-1",
    driverId: "d-1",
    startedAt: new Date(),
    endedAt: overrides.endedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

/** Make $transaction run its callback with the mock prisma object. */
function runTransactionWithPrisma() {
  const fn = prisma.$transaction as ReturnType<typeof vi.fn>;
  fn.mockImplementation(
    (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)
  );
}

function mockSystemOperator() {
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    id: "user-admin"
  } as unknown as Awaited<ReturnType<typeof prisma.user.findFirst>>);
}

// ============================================================================
// startShift — lock + txn + planVersion increment
// ============================================================================

describe("startShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTransactionWithPrisma();
    vi.mocked(acquireDispatchLock).mockResolvedValue(true);
    vi.mocked(releaseDispatchLock).mockResolvedValue(undefined);
    vi.mocked(prisma.driver.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.driverShift.create).mockResolvedValue(mockShift());
  });

  it("creates a shift, increments planVersion, sets onShift+AVAILABLE in one transaction", async () => {
    mockDriver({ onShift: false });

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.driverId).toBe("d-1");
    // conditional update + planVersion
    expect(prisma.driver.updateMany).toHaveBeenCalledWith({
      where: { id: "d-1", isActive: true, onShift: false },
      data: { onShift: true, availability: "AVAILABLE", planVersion: { increment: 1 } }
    });
    // shift created in the same txn
    expect(prisma.driverShift.create).toHaveBeenCalledTimes(1);
    // lock released
    expect(releaseDispatchLock).toHaveBeenCalled();
  });

  it("returns 409 DUPLICATE_OPERATION when lock is held", async () => {
    vi.mocked(acquireDispatchLock).mockResolvedValue(false);

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("DUPLICATE_OPERATION");
    expect(prisma.driver.updateMany).not.toHaveBeenCalled();
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
    expect(prisma.driverShift.create).not.toHaveBeenCalled();
    expect(prisma.driver.updateMany).not.toHaveBeenCalled();
  });

  it("repairs state when onShift=true but no open shift exists", async () => {
    mockDriver({ onShift: true });
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null); // no open shift
    vi.mocked(prisma.driverShift.create).mockResolvedValue(mockShift());

    const result = await startShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(prisma.driverShift.create).toHaveBeenCalledTimes(1);
    // planVersion NOT incremented on repair
  });

  it("returns latest active shift when concurrent startShift wins race", async () => {
    mockDriver({ onShift: false });
    vi.mocked(prisma.driver.updateMany).mockResolvedValue({ count: 0 }); // lost claim
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(mockShift()); // peer created it

    const result = await startShift("d-1", "trace-1");

    // Re-reads and returns the existing open shift (idempotent)
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.id).toBe("shift-1");
  });

  it("throws when shift create fails inside transaction (DB rollback)", async () => {
    mockDriver({ onShift: false });
    // updateMany succeeds but shift create throws — transaction rolls back
    vi.mocked(prisma.driverShift.create).mockRejectedValue(new Error("DB write error"));

    // $transaction throws → propagates to caller. The caller is responsible for
    // returning INTERNAL_ERROR; startShift does not catch this exception itself.
    // The DB state is clean (rollback).
    await expect(startShift("d-1", "trace-1")).rejects.toThrow("DB write error");
    // Lock is released in finally (even on throw)
    expect(releaseDispatchLock).toHaveBeenCalled();
  });
});

// ============================================================================
// endShift — lock + guard-before-release + planVersion always increments
// ============================================================================

describe("endShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTransactionWithPrisma();
    vi.mocked(acquireDispatchLock).mockResolvedValue(true);
    vi.mocked(releaseDispatchLock).mockResolvedValue(undefined);
    vi.mocked(prisma.driverShift.update).mockResolvedValue(
      mockShift({ endedAt: new Date() })
    );
    mockSystemOperator();
  });

  function setupOpenShift() {
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(mockShift({ endedAt: null }));
  }

  function setupNoBlockingAssignments() {
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);
  }

  it("closes shift, sets onShift=false, increments planVersion (no assignments)", async () => {
    mockDriver({ onShift: true });
    setupOpenShift();
    setupNoBlockingAssignments();

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.shift.id).toBe("shift-1");

    // planVersion always incremented (§1.6)
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { onShift: false, planVersion: { increment: 1 } }
    });
    expect(releaseDispatchLock).toHaveBeenCalled();
  });

  it("runs the whole endShift flow inside a single transaction (P0-2)", async () => {
    mockDriver({ onShift: true });
    setupOpenShift();
    setupNoBlockingAssignments();

    await endShift("d-1", "trace-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns NOT_FOUND when driver does not exist", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns ILLEGAL_TRANSITION when driver is not on shift already", async () => {
    mockDriver({ onShift: false });

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("rejects end when driver has EN_ROUTE or IN_SERVICE orders", async () => {
    mockDriver({ onShift: true });
    setupOpenShift();
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      { id: "a-1", orderId: "o-1" } as unknown as Awaited<
        ReturnType<typeof prisma.assignment.findMany>
      >[number]
    ]);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("rolls back and returns INTERNAL_ERROR when a write step fails mid-transaction", async () => {
    mockDriver({ onShift: true });
    setupOpenShift();
    setupNoBlockingAssignments();
    // Shift close throws inside the txn
    vi.mocked(prisma.driverShift.update).mockRejectedValue(new Error("write failure"));

    const result = await endShift("d-1", "trace-1");

    // Transaction rolled back → INTERNAL_ERROR
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  // ---- P1-1 fix: activeShift checked BEFORE release ----

  it("repairs onShift flag without releasing assignments when no open shift exists", async () => {
    mockDriver({ onShift: true });
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null); // NO open shift

    const result = await endShift("d-1", "trace-1");

    // NOT_FOUND, driver.onShift repaired to false, no assignments released
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("NOT_FOUND");

    // assignment.findMany (for release) must NOT have been called
    const callsForRelease = vi
      .mocked(prisma.assignment.findMany)
      .mock.calls.filter((c) => c[0]?.where?.order?.executionStatus?.in);
    expect(callsForRelease).toHaveLength(0);
  });

  // ---- PLANNED release + planVersion ----

  it("releases PLANNED assignments, writes audit logs, and increments planVersion", async () => {
    mockDriver({ onShift: true });
    setupOpenShift();

    // First query: blocking (empty) → second query: PLANNED
    vi.mocked(prisma.assignment.findMany)
      .mockResolvedValueOnce([]) // blocking: none
      .mockResolvedValueOnce([
        { id: "a-plan-1", orderId: "o-1" } as unknown as Awaited<
          ReturnType<typeof prisma.assignment.findMany>
        >[number]
      ]);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    // planVersion always incremented on real end (§1.6)
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { onShift: false, planVersion: { increment: 1 } }
    });
  });

  // ---- Lock conflict ----

  it("returns 409 DUPLICATE_OPERATION when lock is held", async () => {
    vi.mocked(acquireDispatchLock).mockResolvedValue(false);

    const result = await endShift("d-1", "trace-1");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error.code).toBe("DUPLICATE_OPERATION");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getActivePlannedAssignments
// ============================================================================

describe("getActivePlannedAssignments", () => {
  it("returns assignments filtered by driver and PLANNED status", async () => {
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      { id: "a-1", order: { executionStatus: "PLANNED" } }
    ] as unknown as Awaited<ReturnType<typeof prisma.assignment.findMany>>);

    const result = await getActivePlannedAssignments("d-1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a-1");
  });
});

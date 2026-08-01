import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DispatchInputV2, DispatchOutputV2 } from "@/types/v2";

const {
  mockAcquireResourceLocks,
  mockReleaseResourceLock,
  mockBuildDispatchSnapshot,
  mockBuildEtaMatrix,
  mockRunDispatchV2,
  mockCommitDispatchPlan
} = vi.hoisted(() => ({
  mockAcquireResourceLocks: vi.fn(),
  mockReleaseResourceLock: vi.fn(),
  mockBuildDispatchSnapshot: vi.fn(),
  mockBuildEtaMatrix: vi.fn(),
  mockRunDispatchV2: vi.fn(),
  mockCommitDispatchPlan: vi.fn()
}));

vi.mock("@/lib/redis", () => ({
  acquireResourceLocks: mockAcquireResourceLocks,
  releaseResourceLock: mockReleaseResourceLock
}));

vi.mock("../core", () => ({
  runDispatchV2: mockRunDispatchV2
}));

vi.mock("./dispatch-snapshot-service", () => ({
  buildDispatchSnapshot: mockBuildDispatchSnapshot
}));

vi.mock("./eta-matrix-service", () => ({
  buildEtaMatrix: mockBuildEtaMatrix
}));

vi.mock("./dispatch-plan-committer", () => ({
  commitDispatchPlan: mockCommitDispatchPlan,
  STALE_DISPATCH_SNAPSHOT: "STALE_DISPATCH_SNAPSHOT"
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { runDispatchApplication } from "./dispatch-orchestrator";

const event = {
  type: "ORDER_RECEIVED" as const,
  occurredAt: "2026-07-26T06:00:00.000Z",
  orderId: "order-1"
};

const snapshot: DispatchInputV2 = {
  event,
  orders: [
    {
      orderId: "order-1",
      orderNo: "ORDER-1",
      businessType: "STORE_PICKUP",
      executionStatus: "UNASSIGNED",
      feasibility: "UNKNOWN",
      slackMinutes: null,
      promisedPickupAt: "2026-07-26T08:00:00.000Z",
      pickupAddress: "A",
      deliveryAddress: "B",
      storeCode: "STORE-1",
      serviceModuleMinutes: 0
    }
  ],
  drivers: [
    {
      driverId: "driver-1",
      storeCode: "STORE-1",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 1,
      locationFreshness: "FRESH",
      assignments: []
    }
  ]
};

const output: DispatchOutputV2 = {
  proposals: [
    {
      driverId: "driver-1",
      expectedPlanVersion: 1,
      assignments: []
    }
  ],
  evaluations: [],
  calculatedAt: event.occurredAt
};

const committed = {
  changedDriverIds: [],
  releasedAssignments: 0,
  createdAssignments: 0
};

function lockResult(result: "acquired" | "busy" | "unavailable") {
  return new Map([
    ["dispatch:lock:driver-1", result],
    ["order:lock:order-1", result]
  ]);
}

describe("runDispatchApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDispatchSnapshot.mockResolvedValue(snapshot);
    mockBuildEtaMatrix.mockResolvedValue(vi.fn());
    mockRunDispatchV2.mockReturnValue(output);
    mockCommitDispatchPlan.mockResolvedValue(committed);
    mockReleaseResourceLock.mockResolvedValue(undefined);
  });

  it("commits under acquired driver and order locks then releases them", async () => {
    mockAcquireResourceLocks.mockResolvedValue(lockResult("acquired"));

    await expect(
      runDispatchApplication(event, "trace-1")
    ).resolves.toEqual(committed);

    expect(mockAcquireResourceLocks).toHaveBeenCalledWith([
      expect.objectContaining({
        resourceKey: "dispatch:lock:driver-1",
        ttlSeconds: 15
      }),
      expect.objectContaining({
        resourceKey: "order:lock:order-1",
        ttlSeconds: 15
      })
    ]);
    expect(mockCommitDispatchPlan).toHaveBeenCalledWith(
      snapshot,
      output,
      "trace-1"
    );
    expect(mockReleaseResourceLock).toHaveBeenCalledTimes(2);
  });

  it("falls back to database row and version locks when Redis is unavailable", async () => {
    mockAcquireResourceLocks.mockResolvedValue(lockResult("unavailable"));

    await expect(
      runDispatchApplication(event, "trace-1")
    ).resolves.toEqual(committed);

    expect(mockCommitDispatchPlan).toHaveBeenCalledTimes(1);
    expect(mockReleaseResourceLock).not.toHaveBeenCalled();
  });

  it("does not enter the commit transaction when a resource is busy", async () => {
    mockAcquireResourceLocks.mockResolvedValue(lockResult("busy"));

    await expect(
      runDispatchApplication(event, "trace-1")
    ).rejects.toThrow("DISPATCH_RESOURCE_BUSY");

    expect(mockCommitDispatchPlan).not.toHaveBeenCalled();
  });

  it("rebuilds the snapshot after a stale commit and succeeds on retry", async () => {
    mockAcquireResourceLocks.mockResolvedValue(lockResult("acquired"));
    mockCommitDispatchPlan
      .mockRejectedValueOnce(new Error("STALE_DISPATCH_SNAPSHOT"))
      .mockResolvedValueOnce(committed);

    await expect(
      runDispatchApplication(event, "trace-1")
    ).resolves.toEqual(committed);

    expect(mockBuildDispatchSnapshot).toHaveBeenCalledTimes(2);
    expect(mockBuildEtaMatrix).toHaveBeenCalledTimes(2);
    expect(mockCommitDispatchPlan).toHaveBeenCalledTimes(2);
    expect(mockReleaseResourceLock).toHaveBeenCalledTimes(4);
  });
});

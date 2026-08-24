import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  $queryRaw: vi.fn(),
  assignment: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  orderServicePlan: { upsert: vi.fn() },
  driver: { update: vi.fn() },
  operationLog: { create: vi.fn() }
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    )
  }
}));

vi.mock("@/lib/redis", () => ({
  acquireResourceLocks: vi.fn(),
  releaseResourceLock: vi.fn()
}));

vi.mock("@/lib/events/store", () => ({ enqueueInternalEvent: vi.fn() }));
vi.mock("@/lib/events/processor", () => ({ processInternalEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { enqueueInternalEvent } from "@/lib/events/store";
import { processInternalEvent } from "@/lib/events/processor";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import { updateDriverServiceModules } from "./module-command-service";

const now = new Date("2026-08-16T08:00:00.000Z");

function assignmentRow(modules: string[] = ["WASHING"]) {
  return {
    id: "assignment-1",
    orderId: "order-1",
    driverId: "driver-1",
    driver: { planVersion: 4 },
    order: {
      currentAssignmentId: "assignment-1",
      executionStatus: "IN_SERVICE"
    },
    servicePlan: {
      id: "plan-1",
      modulesJson: modules,
      totalModuleMinutes: 10,
      revision: 2,
      updatedAt: now,
      updatedByUserId: "user-1"
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.assignment.findUnique).mockResolvedValue({
    driverId: "driver-1",
    orderId: "order-1"
  } as never);
  tx.assignment.findUnique.mockResolvedValue(assignmentRow());
  tx.user.findUnique.mockResolvedValue({ id: "user-1" });
  tx.orderServicePlan.upsert.mockResolvedValue({
    id: "plan-1",
    assignmentId: "assignment-1",
    modulesJson: ["CHARGING", "WASHING"],
    totalModuleMinutes: 40,
    revision: 3,
    updatedAt: now,
    updatedByUserId: "user-1"
  });
  vi.mocked(acquireResourceLocks).mockResolvedValue(
    new Map([
      ["dispatch:lock:driver-1", "acquired"],
      ["order:lock:order-1", "acquired"]
    ])
  );
  vi.mocked(enqueueInternalEvent).mockResolvedValue({
    eventId: "service-plan:assignment-1:revision:3",
    committed: true
  });
  vi.mocked(processInternalEvent).mockResolvedValue("processed");
});

describe("driver service module command", () => {
  it("returns a structured internal error when the ownership preflight fails", async () => {
    vi.mocked(prisma.assignment.findUnique).mockRejectedValue(
      new Error("database unavailable")
    );

    const result = await updateDriverServiceModules({
      assignmentId: "assignment-1",
      driverId: "driver-1",
      modules: ["WASHING"],
      traceId: "trace-preflight"
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "INTERNAL_ERROR" })
      })
    );
    expect(acquireResourceLocks).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns a structured internal error when lock acquisition fails", async () => {
    vi.mocked(acquireResourceLocks).mockRejectedValue(
      new Error("redis unavailable")
    );

    const result = await updateDriverServiceModules({
      assignmentId: "assignment-1",
      driverId: "driver-1",
      modules: ["WASHING"],
      traceId: "trace-lock"
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "INTERNAL_ERROR" })
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(releaseResourceLock).not.toHaveBeenCalled();
  });

  it("rejects a task owned by another driver before any write", async () => {
    vi.mocked(prisma.assignment.findUnique).mockResolvedValue({
      driverId: "driver-other",
      orderId: "order-1"
    } as never);

    const result = await updateDriverServiceModules({
      assignmentId: "assignment-1",
      driverId: "driver-1",
      modules: ["WASHING"],
      traceId: "trace-1"
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "FORBIDDEN" })
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("atomically updates modules, planVersion, audit log and dispatch outbox", async () => {
    const result = await updateDriverServiceModules({
      assignmentId: "assignment-1",
      driverId: "driver-1",
      modules: ["WASHING", "CHARGING"],
      traceId: "trace-1"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        planVersion: 5,
        replayed: false,
        servicePlan: expect.objectContaining({
          modules: ["CHARGING", "WASHING"],
          totalModuleMinutes: 40,
          revision: 3
        })
      })
    });
    expect(tx.orderServicePlan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          modulesJson: ["CHARGING", "WASHING"],
          totalModuleMinutes: 40,
          revision: { increment: 1 }
        })
      })
    );
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { planVersion: 5 }
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "SERVICE_PLAN",
        action: "MODULE_CHANGE",
        orderId: "order-1",
        driverId: "driver-1",
        assignmentId: "assignment-1",
        traceId: "trace-1",
        metadataJson: {
          before: { modules: ["WASHING"], planVersion: 4 },
          after: {
            modules: ["CHARGING", "WASHING"],
            planVersion: 5
          }
        }
      })
    });
    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "MODULE_CHANGE_APPLIED",
        orderId: "order-1",
        driverId: "driver-1",
        assignmentId: "assignment-1",
        traceId: "trace-1"
      })
    );
    expect(processInternalEvent).toHaveBeenCalledWith(
      "service-plan:assignment-1:revision:3"
    );
    expect(releaseResourceLock).toHaveBeenCalledTimes(2);
  });

  it("treats the same module set as a replay with zero side effects", async () => {
    const result = await updateDriverServiceModules({
      assignmentId: "assignment-1",
      driverId: "driver-1",
      modules: ["WASHING"],
      traceId: "trace-1"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ replayed: true, planVersion: 4 })
    });
    expect(tx.orderServicePlan.upsert).not.toHaveBeenCalled();
    expect(tx.driver.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
  });
});

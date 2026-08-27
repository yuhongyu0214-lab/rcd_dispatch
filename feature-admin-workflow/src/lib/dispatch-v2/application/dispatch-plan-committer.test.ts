import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DispatchInputV2, DispatchOutputV2 } from "@/types/v2";

const tx = {
  $queryRaw: vi.fn(),
  driver: {
    findMany: vi.fn(),
    update: vi.fn()
  },
  user: {
    findFirst: vi.fn()
  },
  assignment: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn()
  },
  order: {
    updateMany: vi.fn()
  },
  operationLog: {
    create: vi.fn()
  },
  orderServicePlan: {
    create: vi.fn()
  },
  dispatchAlert: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn()
  }
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx)
    )
  }
}));

import {
  commitDispatchPlan,
  STALE_DISPATCH_SNAPSHOT
} from "./dispatch-plan-committer";

const snapshot: DispatchInputV2 = {
  event: {
    type: "ORDER_RECEIVED",
    occurredAt: "2026-07-26T06:00:00.000Z",
    orderId: "o-2"
  },
  orders: [
    {
      orderId: "o-1",
      orderNo: "O-1",
      businessType: "STORE_PICKUP",
      executionStatus: "PLANNED",
      feasibility: "NORMAL",
      slackMinutes: 20,
      promisedPickupAt: "2026-07-26T08:00:00.000Z",
      pickupAddress: "A",
      deliveryAddress: "B",
      storeCode: "S1",
      currentAssignmentId: "a-1",
      serviceModuleMinutes: 0
    },
    {
      orderId: "o-2",
      orderNo: "O-2",
      businessType: "STORE_PICKUP",
      executionStatus: "UNASSIGNED",
      feasibility: "UNKNOWN",
      slackMinutes: null,
      promisedPickupAt: "2026-07-26T09:00:00.000Z",
      pickupAddress: "C",
      deliveryAddress: "D",
      storeCode: "S1",
      serviceModuleMinutes: 0
    }
  ],
  drivers: [
    {
      driverId: "d-1",
      storeCode: "S1",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 4,
      locationFreshness: "FRESH",
      assignments: [
        {
          assignmentId: "a-1",
          orderId: "o-1",
          sequenceNo: 1,
          lockType: "NONE",
          executionStatus: "PLANNED",
          serviceModuleMinutes: 0
        }
      ]
    }
  ]
};

const output: DispatchOutputV2 = {
  calculatedAt: "2026-07-26T06:00:00.000Z",
  proposals: [
    {
      driverId: "d-1",
      expectedPlanVersion: 4,
      assignments: [
        {
          assignmentId: null,
          orderId: "o-2",
          sequenceNo: 1,
          slot: "A",
          plannedDepartAt: "2026-07-26T06:00:00.000Z",
          plannedPickupAt: "2026-07-26T06:20:00.000Z",
          plannedCompleteAt: "2026-07-26T07:00:00.000Z",
          deadheadEtaMinutes: 20,
          serviceEtaMinutes: 40,
          etaAvailable: true
        }
      ]
    }
  ],
  evaluations: [
    {
      orderId: "o-2",
      result: "PLANNED",
      bestSlackMinutes: 160,
      reason: "PLANNED"
    }
  ]
};

describe("commitDispatchPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
    tx.driver.findMany.mockResolvedValue([{ id: "d-1", planVersion: 4 }]);
    tx.user.findFirst.mockResolvedValue({ id: "system-user" });
    tx.assignment.findUnique.mockResolvedValue({
      id: "a-1",
      orderId: "o-1",
      driverId: "d-1"
    });
    tx.assignment.updateMany.mockResolvedValue({ count: 1 });
    tx.assignment.create.mockResolvedValue({ id: "a-2" });
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.dispatchAlert.findFirst.mockResolvedValue(null);
  });

  it("releases mutable assignments, creates the new plan, and advances one version", async () => {
    const result = await commitDispatchPlan(snapshot, output, "trace-1");

    expect(result).toEqual({
      changedDriverIds: ["d-1"],
      releasedAssignments: 1,
      createdAssignments: 1
    });
    expect(tx.assignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RECYCLED",
          sequenceNo: null
        })
      })
    );
    expect(tx.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "o-2",
          driverId: "d-1",
          sequenceNo: 1
        })
      })
    );
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { planVersion: 5 }
    });
  });

  it("rejects a stale plan before assignment writes", async () => {
    tx.driver.findMany.mockResolvedValue([{ id: "d-1", planVersion: 5 }]);

    await expect(
      commitDispatchPlan(snapshot, output, "trace-1")
    ).rejects.toThrow(STALE_DISPATCH_SNAPSHOT);
    expect(tx.assignment.updateMany).not.toHaveBeenCalled();
    expect(tx.assignment.create).not.toHaveBeenCalled();
  });

  it("does not recycle and recreate an identical logical plan on event retry", async () => {
    const retrySnapshot: DispatchInputV2 = {
      ...snapshot,
      orders: [
        {
          ...snapshot.orders[1],
          executionStatus: "PLANNED",
          currentAssignmentId: "a-2",
          feasibility: "NORMAL",
          slackMinutes: 160
        }
      ],
      drivers: [
        {
          ...snapshot.drivers[0],
          assignments: [
            {
              assignmentId: "a-2",
              orderId: "o-2",
              sequenceNo: 1,
              lockType: "NONE",
              executionStatus: "PLANNED",
              plannedDepartAt: "2026-07-26T06:00:00.000Z",
              plannedCompleteAt: "2026-07-26T07:00:00.000Z",
              serviceModuleMinutes: 0
            }
          ]
        }
      ]
    };
    tx.assignment.findUnique.mockResolvedValue({
      id: "a-2",
      orderId: "o-2",
      driverId: "d-1",
      status: "ACTIVE",
      lockType: "NONE",
      sequenceNo: 1,
      plannedDepartAt: new Date("2026-07-26T06:00:00.000Z"),
      plannedPickupAt: new Date("2026-07-26T06:20:00.000Z"),
      plannedCompleteAt: new Date("2026-07-26T07:00:00.000Z"),
      deadheadEtaMinutes: 20,
      serviceEtaMinutes: 40,
      etaUnavailableReason: null,
      order: {
        executionStatus: "PLANNED",
        currentAssignmentId: "a-2"
      }
    });

    await expect(
      commitDispatchPlan(retrySnapshot, output, "trace-1")
    ).resolves.toEqual({
      changedDriverIds: [],
      releasedAssignments: 0,
      createdAssignments: 0
    });

    expect(tx.assignment.updateMany).not.toHaveBeenCalled();
    expect(tx.assignment.create).not.toHaveBeenCalled();
    expect(tx.driver.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it("still replaces the assignment when a real ETA plan field changed", async () => {
    const servicePlanUpdatedAt = new Date("2026-07-26T05:55:00.000Z");
    const changedPlanSnapshot: DispatchInputV2 = {
      ...snapshot,
      orders: [
        {
          ...snapshot.orders[1],
          executionStatus: "PLANNED",
          currentAssignmentId: "a-2"
        }
      ],
      drivers: [
        {
          ...snapshot.drivers[0],
          assignments: [
            {
              assignmentId: "a-2",
              orderId: "o-2",
              sequenceNo: 1,
              lockType: "NONE",
              executionStatus: "PLANNED",
              plannedDepartAt: "2026-07-26T06:00:00.000Z",
              plannedCompleteAt: "2026-07-26T07:10:00.000Z",
              serviceModuleMinutes: 0
            }
          ]
        }
      ]
    };
    tx.assignment.findUnique.mockResolvedValue({
      id: "a-2",
      orderId: "o-2",
      driverId: "d-1",
      status: "ACTIVE",
      lockType: "NONE",
      sequenceNo: 1,
      plannedDepartAt: new Date("2026-07-26T06:00:00.000Z"),
      plannedPickupAt: new Date("2026-07-26T06:30:00.000Z"),
      plannedCompleteAt: new Date("2026-07-26T07:10:00.000Z"),
      deadheadEtaMinutes: 30,
      serviceEtaMinutes: 40,
      etaUnavailableReason: null,
      order: {
        executionStatus: "PLANNED",
        currentAssignmentId: "a-2"
      },
      servicePlan: {
        modulesJson: ["REFUELING", "WASHING"],
        totalModuleMinutes: 15,
        revision: 2,
        updatedByUserId: "driver-user",
        updatedAt: servicePlanUpdatedAt
      }
    });
    tx.assignment.create.mockResolvedValueOnce({ id: "a-3" });

    await expect(
      commitDispatchPlan(changedPlanSnapshot, output, "trace-2")
    ).resolves.toEqual({
      changedDriverIds: ["d-1"],
      releasedAssignments: 1,
      createdAssignments: 1
    });

    expect(tx.assignment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.assignment.create).toHaveBeenCalledTimes(1);
    expect(tx.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plannedCompleteAt: new Date("2026-07-26T07:00:00.000Z"),
          serviceEtaMinutes: 40
        })
      })
    );
    expect(tx.orderServicePlan.create).toHaveBeenCalledWith({
      data: {
        assignmentId: "a-3",
        modulesJson: ["REFUELING", "WASHING"],
        totalModuleMinutes: 15,
        revision: 2,
        updatedByUserId: "driver-user",
        updatedAt: servicePlanUpdatedAt
      }
    });
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "d-1" },
      data: { planVersion: 5 }
    });
  });

  it("copies each released service plan only to its own replacement assignment", async () => {
    const firstPlanUpdatedAt = new Date("2026-07-26T05:50:00.000Z");
    const secondPlanUpdatedAt = new Date("2026-07-26T05:55:00.000Z");
    const multiOrderSnapshot: DispatchInputV2 = {
      ...snapshot,
      event: {
        type: "ORDER_RECEIVED",
        occurredAt: "2026-07-26T06:00:00.000Z",
        orderId: "o-3"
      },
      orders: [
        snapshot.orders[0],
        {
          ...snapshot.orders[1],
          executionStatus: "PLANNED",
          currentAssignmentId: "a-2"
        },
        {
          ...snapshot.orders[1],
          orderId: "o-3",
          orderNo: "O-3",
          executionStatus: "UNASSIGNED",
          currentAssignmentId: undefined
        }
      ],
      drivers: [
        {
          ...snapshot.drivers[0],
          assignments: [
            {
              assignmentId: "a-1",
              orderId: "o-1",
              sequenceNo: 1,
              lockType: "NONE",
              executionStatus: "PLANNED",
              serviceModuleMinutes: 10
            },
            {
              assignmentId: "a-2",
              orderId: "o-2",
              sequenceNo: 2,
              lockType: "NONE",
              executionStatus: "PLANNED",
              serviceModuleMinutes: 35
            }
          ]
        }
      ]
    };
    const multiOrderOutput: DispatchOutputV2 = {
      calculatedAt: "2026-07-26T06:00:00.000Z",
      proposals: [
        {
          driverId: "d-1",
          expectedPlanVersion: 4,
          assignments: [
            {
              assignmentId: null,
              orderId: "o-1",
              sequenceNo: 1,
              slot: "A",
              plannedDepartAt: "2026-07-26T06:00:00.000Z",
              plannedPickupAt: "2026-07-26T06:10:00.000Z",
              plannedCompleteAt: "2026-07-26T07:00:00.000Z",
              deadheadEtaMinutes: 10,
              serviceEtaMinutes: 40,
              etaAvailable: true
            },
            {
              assignmentId: null,
              orderId: "o-2",
              sequenceNo: 2,
              slot: "B",
              plannedDepartAt: "2026-07-26T07:00:00.000Z",
              plannedPickupAt: "2026-07-26T07:10:00.000Z",
              plannedCompleteAt: "2026-07-26T08:00:00.000Z",
              deadheadEtaMinutes: 10,
              serviceEtaMinutes: 40,
              etaAvailable: true
            },
            {
              assignmentId: null,
              orderId: "o-3",
              sequenceNo: 3,
              slot: "C",
              plannedDepartAt: "2026-07-26T08:00:00.000Z",
              plannedPickupAt: "2026-07-26T08:10:00.000Z",
              plannedCompleteAt: "2026-07-26T09:00:00.000Z",
              deadheadEtaMinutes: 10,
              serviceEtaMinutes: 40,
              etaAvailable: true
            }
          ]
        }
      ],
      evaluations: [
        {
          orderId: "o-1",
          result: "PLANNED",
          bestSlackMinutes: 120,
          reason: "PLANNED"
        },
        {
          orderId: "o-2",
          result: "PLANNED",
          bestSlackMinutes: 110,
          reason: "PLANNED"
        },
        {
          orderId: "o-3",
          result: "PLANNED",
          bestSlackMinutes: 100,
          reason: "PLANNED"
        }
      ]
    };

    tx.assignment.findUnique.mockReset();
    tx.assignment.findUnique
      .mockResolvedValueOnce({
        id: "a-1",
        orderId: "o-1",
        driverId: "d-1",
        status: "ACTIVE",
        lockType: "NONE",
        sequenceNo: 1,
        plannedDepartAt: new Date("2026-07-26T06:00:00.000Z"),
        plannedPickupAt: new Date("2026-07-26T06:10:00.000Z"),
        plannedCompleteAt: new Date("2026-07-26T07:05:00.000Z"),
        deadheadEtaMinutes: 10,
        serviceEtaMinutes: 40,
        etaUnavailableReason: null,
        order: {
          executionStatus: "PLANNED",
          currentAssignmentId: "a-1"
        }
      })
      .mockResolvedValueOnce({
        id: "a-2",
        orderId: "o-2",
        driverId: "d-1",
        status: "ACTIVE",
        lockType: "NONE",
        sequenceNo: 2,
        plannedDepartAt: new Date("2026-07-26T07:00:00.000Z"),
        plannedPickupAt: new Date("2026-07-26T07:10:00.000Z"),
        plannedCompleteAt: new Date("2026-07-26T08:05:00.000Z"),
        deadheadEtaMinutes: 10,
        serviceEtaMinutes: 40,
        etaUnavailableReason: null,
        order: {
          executionStatus: "PLANNED",
          currentAssignmentId: "a-2"
        }
      })
      .mockResolvedValueOnce({
        id: "a-1",
        orderId: "o-1",
        driverId: "d-1",
        servicePlan: {
          modulesJson: ["WASHING"],
          totalModuleMinutes: 10,
          revision: 1,
          updatedByUserId: "driver-user-1",
          updatedAt: firstPlanUpdatedAt
        }
      })
      .mockResolvedValueOnce({
        id: "a-2",
        orderId: "o-2",
        driverId: "d-1",
        servicePlan: {
          modulesJson: ["CHARGING", "RETURN_FORMALITIES"],
          totalModuleMinutes: 35,
          revision: 4,
          updatedByUserId: "driver-user-2",
          updatedAt: secondPlanUpdatedAt
        }
      });
    tx.assignment.create.mockReset();
    tx.assignment.create
      .mockResolvedValueOnce({ id: "new-a-1" })
      .mockResolvedValueOnce({ id: "new-a-2" })
      .mockResolvedValueOnce({ id: "new-a-3" });

    await expect(
      commitDispatchPlan(multiOrderSnapshot, multiOrderOutput, "trace-multi")
    ).resolves.toEqual({
      changedDriverIds: ["d-1"],
      releasedAssignments: 2,
      createdAssignments: 3
    });

    expect(tx.orderServicePlan.create.mock.calls.map(([write]) => write)).toEqual(
      [
        {
          data: {
            assignmentId: "new-a-1",
            modulesJson: ["WASHING"],
            totalModuleMinutes: 10,
            revision: 1,
            updatedByUserId: "driver-user-1",
            updatedAt: firstPlanUpdatedAt
          }
        },
        {
          data: {
            assignmentId: "new-a-2",
            modulesJson: ["CHARGING", "RETURN_FORMALITIES"],
            totalModuleMinutes: 35,
            revision: 4,
            updatedByUserId: "driver-user-2",
            updatedAt: secondPlanUpdatedAt
          }
        }
      ]
    );
    expect(tx.orderServicePlan.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignmentId: "new-a-3" })
      })
    );
  });
});

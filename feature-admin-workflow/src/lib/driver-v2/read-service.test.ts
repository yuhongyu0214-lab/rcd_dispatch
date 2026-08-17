import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findMany: vi.fn() },
    order: { findMany: vi.fn() }
  }
}));

import { prisma } from "@/lib/prisma";

import { listDriverTasks, listUnassignedOrders } from "./read-service";

const now = new Date("2026-08-16T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.assignment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.order.findMany).mockResolvedValue([]);
});

describe("driver V2 read service", () => {
  it("returns only the authenticated driver's current A/B/C assignments", async () => {
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      {
        id: "assignment-a",
        orderId: "order-a",
        driverId: "driver-self",
        sequenceNo: 1,
        lockType: "AUTO_FROZEN",
        plannedPickupAt: now,
        plannedCompleteAt: new Date("2026-08-16T09:00:00.000Z"),
        order: {
          orderNo: "ORDER-A",
          type: "DOOR_DELIVERY",
          executionStatus: "EN_ROUTE",
          feasibility: "NORMAL",
          promisedPickupAt: now,
          pickupLat: 31.2304,
          pickupLng: 121.4737,
          deliveryLat: null,
          deliveryLng: null,
          pickupAddress: "取车点",
          deliveryAddress: ""
        },
        servicePlan: {
          modulesJson: ["WASHING"],
          totalModuleMinutes: 10,
          revision: 2,
          updatedAt: now,
          updatedByUserId: "user-driver"
        }
      }
    ] as never);

    const result = await listDriverTasks("driver-self");

    expect(prisma.assignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          driverId: "driver-self",
          sequenceNo: { in: [1, 2, 3] },
          currentForOrders: {
            some: {
              executionStatus: { in: ["PLANNED", "EN_ROUTE", "IN_SERVICE"] }
            }
          }
        }),
        orderBy: { sequenceNo: "asc" }
      })
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "assignment-a",
        orderId: "order-a",
        orderNo: "ORDER-A",
        businessType: "DOOR_DELIVERY",
        executionStatus: "EN_ROUTE",
        slot: "A",
        lockType: "AUTO_FROZEN",
        pickupPoint: { lat: 31.2304, lng: 121.4737 },
        pickupAddress: "取车点",
        servicePlan: expect.objectContaining({
          modules: ["WASHING"],
          revision: 2
        })
      })
    ]);
    expect(result[0]).not.toHaveProperty("driverId");
    expect(result[0]).not.toHaveProperty("deliveryPoint");
    expect(result[0]).not.toHaveProperty("deliveryAddress");
  });

  it("returns an explicit null service plan when no plan exists", async () => {
    vi.mocked(prisma.assignment.findMany).mockResolvedValue([
      {
        id: "assignment-without-plan",
        orderId: "order-without-plan",
        driverId: "driver-self",
        sequenceNo: 2,
        lockType: "NONE",
        plannedPickupAt: null,
        plannedCompleteAt: null,
        order: {
          orderNo: "ORDER-WITHOUT-PLAN",
          type: "STORE_PICKUP",
          executionStatus: "PLANNED",
          feasibility: "UNKNOWN",
          promisedPickupAt: now,
          pickupLat: null,
          pickupLng: null,
          deliveryLat: null,
          deliveryLng: null,
          pickupAddress: "取车点",
          deliveryAddress: "送达点"
        },
        servicePlan: null
      }
    ] as never);

    const result = await listDriverTasks("driver-self");

    expect(result).toEqual([
      expect.objectContaining({
        id: "assignment-without-plan",
        slot: "B",
        servicePlan: null
      })
    ]);
  });

  it("returns only truly unassigned orders and omits missing coordinates", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      {
        id: "order-u",
        orderNo: "ORDER-U",
        type: "STORE_RETURN",
        executionStatus: "UNASSIGNED",
        feasibility: "AT_RISK",
        promisedPickupAt: now,
        pickupLat: null,
        pickupLng: null,
        deliveryLat: 31.2,
        deliveryLng: 121.4,
        pickupAddress: "",
        deliveryAddress: "送达点"
      }
    ] as never);

    const result = await listUnassignedOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { executionStatus: "UNASSIGNED", currentAssignmentId: null },
        orderBy: [{ promisedPickupAt: "asc" }, { id: "asc" }]
      })
    );
    expect(result).toEqual([
      {
        orderId: "order-u",
        orderNo: "ORDER-U",
        businessType: "STORE_RETURN",
        executionStatus: "UNASSIGNED",
        slot: "NONE",
        lockType: "NONE",
        feasibility: "AT_RISK",
        promisedPickupAt: now.toISOString(),
        deliveryPoint: { lat: 31.2, lng: 121.4 },
        deliveryAddress: "送达点"
      }
    ]);
  });
});

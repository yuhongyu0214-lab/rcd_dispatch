import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    driver: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    dispatchAlert: { count: vi.fn() }
  }
}));
vi.mock("@/lib/redis", () => ({ getDriverLocationsWithStatus: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getDriverLocationsWithStatus } from "@/lib/redis";

import {
  getDriverPlan,
  getMapSnapshot,
  getOrderDetail,
  listOrders
} from "./read-service";

const now = new Date("2026-08-16T08:00:00.000Z");

function orderRow() {
  return {
    id: "order-1",
    orderNo: "ORDER-1",
    sourceSystem: "API",
    externalOrderId: "external-1",
    sourceVersion: "000001",
    type: "DOOR_DELIVERY",
    executionStatus: "UNASSIGNED",
    feasibility: "UNKNOWN",
    slackMinutes: null,
    promisedPickupAt: now,
    receivedAt: now,
    pickupAddress: "取车点",
    pickupLat: 31.1,
    pickupLng: 121.1,
    deliveryAddress: "送达点",
    deliveryLat: 31.2,
    deliveryLng: 121.2,
    licensePlateSnapshot: null,
    vehicleTypeSnapshot: null,
    remark: null,
    cancelledAt: null,
    currentAssignmentId: null,
    createdAt: now,
    updatedAt: now,
    store: { code: "STORE-1", name: "一店" }
  };
}

function driverRow() {
  return {
    id: "driver-1",
    name: "司机一",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 3,
    lastLat: 31.1,
    lastLng: 121.1,
    lastAccuracyMeters: 20,
    lastLocationCapturedAt: now,
    store: { code: "STORE-1" },
    shifts: [{ startedAt: now }],
    assignments: [
      {
        id: "assignment-1",
        orderId: "order-1",
        driverId: "driver-1",
        sequenceNo: 1,
        lockType: "MANUAL_LOCKED",
        plannedDepartAt: null,
        plannedPickupAt: now,
        plannedCompleteAt: now,
        deadheadEtaMinutes: null,
        serviceEtaMinutes: null,
        etaUnavailableReason: null,
        departedAt: null,
        arrivedAt: null,
        completedAt: null,
        lastEtaCalculatedAt: null,
        order: { orderNo: "ORDER-1", executionStatus: "PLANNED" }
      }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.order.count).mockResolvedValue(0);
  vi.mocked(prisma.order.findMany).mockResolvedValue([]);
  vi.mocked(prisma.driver.count).mockResolvedValue(0);
  vi.mocked(prisma.driver.findMany).mockResolvedValue([]);
  vi.mocked(prisma.dispatchAlert.count).mockResolvedValue(0);
  vi.mocked(getDriverLocationsWithStatus).mockResolvedValue({
    redisAvailable: true,
    locations: new Map()
  });
});

describe("dispatcher read service", () => {
  it("applies frozen order filters and returns a mapped page", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(1);
    vi.mocked(prisma.order.findMany).mockResolvedValue([orderRow()] as never);

    const result = await listOrders({
      page: 2,
      pageSize: 20,
      executionStatus: "UNASSIGNED",
      feasibility: "UNKNOWN",
      slot: "NONE",
      storeCode: "STORE-1",
      keyword: "ORDER"
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "order-1",
          businessType: "DOOR_DELIVERY",
          storeCode: "STORE-1"
        })
      ],
      total: 1,
      page: 2,
      pageSize: 20
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: expect.objectContaining({
          executionStatus: "UNASSIGNED",
          feasibility: "UNKNOWN",
          currentAssignment: null,
          store: { code: "STORE-1" }
        })
      })
    );
  });

  it("returns map drivers, all order points and the OPEN alert count", async () => {
    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      driverRow(),
      {
        ...driverRow(),
        id: "driver-invalid-location",
        lastLat: Number.NaN,
        assignments: []
      }
    ] as never);
    vi.mocked(prisma.order.findMany).mockResolvedValue([orderRow()] as never);
    vi.mocked(prisma.dispatchAlert.count).mockResolvedValue(2);
    vi.mocked(getDriverLocationsWithStatus).mockResolvedValue({
      redisAvailable: true,
      locations: new Map([
        [
          "driver-1",
          {
            lat: "31.3",
            lng: "121.3",
            accuracy: "10",
            ts: new Date().toISOString(),
            server_ts: new Date().toISOString(),
            status: "online"
          }
        ]
      ])
    });

    const result = await getMapSnapshot();

    expect(result.openAlertCount).toBe(2);
    expect(result.orders).toHaveLength(1);
    expect(result.drivers[0]).toEqual(
      expect.objectContaining({
        id: "driver-1",
        locationFreshness: "FRESH",
        lastLocation: expect.objectContaining({ lat: 31.1, lng: 121.1 }),
        slots: { A: expect.objectContaining({ id: "assignment-1" }) }
      })
    );
    expect(result.drivers[1].lastLocation).toBeUndefined();
  });

  it("returns the frozen driver plan without inventing ETA numbers", async () => {
    vi.mocked(prisma.driver.findFirst).mockResolvedValue(driverRow() as never);

    const result = await getDriverPlan("driver-1");

    expect(result).toEqual(
      expect.objectContaining({
        id: "driver-1",
        planVersion: 3,
        slots: { A: expect.objectContaining({ id: "assignment-1" }) }
      })
    );
    expect(JSON.stringify(result)).not.toContain("etaMinutes");
  });

  it("returns null for an unknown order detail", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
    await expect(getOrderDetail("missing")).resolves.toBeNull();
  });
});

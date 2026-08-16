import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  listDrivers,
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

afterEach(() => {
  vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T08:01:00.000Z"));
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
            ts: "2026-08-16T07:59:00.000Z",
            server_ts: "2026-08-16T07:59:00.000Z",
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

  it("returns the frozen paginated driver envelope and applies database pagination", async () => {
    vi.mocked(prisma.driver.count).mockResolvedValue(5);
    vi.mocked(prisma.driver.findMany).mockResolvedValue([driverRow()] as never);

    const result = await listDrivers({ page: 3, pageSize: 2 });

    expect(result).toEqual({
      items: [expect.objectContaining({ id: "driver-1", planVersion: 3 })],
      total: 5,
      page: 3,
      pageSize: 2
    });
    expect(prisma.driver.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        skip: 4,
        take: 2
      })
    );
  });

  it("returns frozen order modification summaries without exposing metadataJson", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...orderRow(),
      currentAssignment: null,
      dispatchAlerts: [],
      operationLogs: [
        {
          id: "log-2",
          reason: "客户改址",
          traceId: "trace-log-2",
          metadataJson: {
            before: {
              pickupLat: 31.1,
              pickupLng: 121.1,
              deliveryAddress: "旧送达点",
              pickupAddress: "旧取车点",
              internalSecret: "before-secret",
              unsupported: { private: true }
            },
            after: {
              pickupLat: 31.3,
              pickupLng: 121.1,
              deliveryAddress: "新送达点",
              pickupAddress: "新取车点",
              internalSecret: "after-secret",
              unsupported: { private: false }
            },
            internalSecret: "must-not-leak"
          },
          createdAt: new Date("2026-08-16T08:30:00.000Z"),
          operatorUser: { id: "dispatcher-1", name: "调度员" }
        },
        {
          id: "log-1",
          reason: null,
          traceId: null,
          metadataJson: {
            before: { promisedPickupAt: "2026-08-16T09:00:00.000Z" },
            after: { promisedPickupAt: "2026-08-16T09:30:00.000Z" }
          },
          createdAt: new Date("2026-08-16T08:10:00.000Z"),
          operatorUser: { id: "dispatcher-2", name: "值班员" }
        }
      ]
    } as never);

    const result = await getOrderDetail("order-1");

    expect(result?.modificationHistory).toEqual([
      {
        id: "log-2",
        operator: { id: "dispatcher-1", name: "调度员" },
        reason: "客户改址",
        changes: [
          { field: "deliveryAddress", before: "旧送达点", after: "新送达点" },
          { field: "pickupAddress", before: "旧取车点", after: "新取车点" },
          { field: "pickupLat", before: 31.1, after: 31.3 }
        ],
        traceId: "trace-log-2",
        createdAt: "2026-08-16T08:30:00.000Z"
      },
      {
        id: "log-1",
        operator: { id: "dispatcher-2", name: "值班员" },
        reason: null,
        changes: [
          {
            field: "promisedPickupAt",
            before: "2026-08-16T09:00:00.000Z",
            after: "2026-08-16T09:30:00.000Z"
          }
        ],
        traceId: null,
        createdAt: "2026-08-16T08:10:00.000Z"
      }
    ]);
    expect(JSON.stringify(result?.modificationHistory)).not.toContain("metadataJson");
    expect(JSON.stringify(result?.modificationHistory)).not.toContain("internalSecret");
    expect(JSON.stringify(result?.modificationHistory)).not.toContain("after-secret");
    expect(JSON.stringify(result?.modificationHistory)).not.toContain("must-not-leak");
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          operationLogs: expect.objectContaining({
            where: { action: "ORDER_MODIFY" },
            orderBy: { createdAt: "desc" },
            select: expect.objectContaining({
              metadataJson: true,
              traceId: true
            })
          })
        })
      })
    );
  });

  it("returns null for an unknown order detail", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
    await expect(getOrderDetail("missing")).resolves.toBeNull();
  });
});

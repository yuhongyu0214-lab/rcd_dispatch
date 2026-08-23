import { describe, expect, it } from "vitest";

import type { AssignmentV2, DriverV2, OrderV2 } from "@/types/v2";

import {
  buildDriverGantt,
  buildTimelineSegments,
  DISPATCHER_V2_NAVIGATION,
  filterDriversByKeyword,
  filterVisibleOrders,
  isCurrentAssignmentDetail,
  isLatestSnapshotRequest,
  ORDER_BUSINESS_META,
  orderMatchesKeyword,
  resolveOrderMapPoint,
  resolveAssignedDriverId,
  resolveDriverPlanStatus,
  resolveOrderPromiseTimes,
  shouldFetchOrderDetail,
  sortOrdersForDispatchList
} from "./dispatcher-console-model";

function order(overrides: Partial<OrderV2> = {}): OrderV2 {
  return {
    id: "order-1",
    orderNo: "RCD-001",
    sourceSystem: "API",
    externalOrderId: "external-1",
    sourceVersion: "1",
    businessType: "DOOR_DELIVERY",
    executionStatus: "PLANNED",
    feasibility: "NORMAL",
    slackMinutes: 18,
    promisedPickupAt: "2026-08-16T10:00:00.000Z",
    receivedAt: "2026-08-16T08:00:00.000Z",
    pickupAddress: "取车点",
    pickupLat: 31.23,
    pickupLng: 121.47,
    deliveryAddress: "送达点",
    deliveryLat: 31.24,
    deliveryLng: 121.48,
    storeCode: "SHA-01",
    createdAt: "2026-08-16T08:00:00.000Z",
    updatedAt: "2026-08-16T08:00:00.000Z",
    ...overrides
  };
}

function assignment(overrides: Partial<AssignmentV2> = {}): AssignmentV2 {
  return {
    id: "assignment-1",
    orderId: "order-1",
    driverId: "driver-1",
    sequenceNo: 1,
    slot: "A",
    lockType: "MANUAL_LOCKED",
    plannedDepartAt: "2026-08-16T09:10:00.000Z",
    plannedPickupAt: "2026-08-16T09:30:00.000Z",
    plannedCompleteAt: "2026-08-16T10:20:00.000Z",
    deadheadEtaMinutes: 20,
    serviceEtaMinutes: 35,
    lastEtaCalculatedAt: "2026-08-16T09:00:00.000Z",
    etaAvailable: true,
    ...overrides
  } as AssignmentV2;
}

function driver(overrides: Partial<DriverV2> = {}): DriverV2 {
  return {
    id: "driver-1",
    name: "王师傅",
    storeCode: "SHA-01",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 4,
    locationFreshness: "FRESH",
    slots: {},
    ...overrides
  };
}

describe("dispatcher console model", () => {
  it("keeps the V2 navigation on stable V2 pages without retired import or V1 driver targets", () => {
    expect(DISPATCHER_V2_NAVIGATION).toEqual([
      {
        entry: "map",
        href: "/admin/map/v2",
        label: "地图",
        title: "V2 调度地图"
      },
      {
        entry: "orders",
        href: "/admin/orders/v2",
        label: "订单",
        title: "V2 订单池"
      }
    ]);
    const hrefs: readonly string[] = DISPATCHER_V2_NAVIGATION.map(
      (item) => item.href
    );
    expect(hrefs).not.toContain("/admin/import");
    expect(hrefs.some((href) => href.includes("mode=drivers"))).toBe(false);
  });

  it("rejects a slower snapshot response after a newer request starts", () => {
    const slowRequestId = 1;
    const latestRequestId = 2;

    expect(isLatestSnapshotRequest(slowRequestId, latestRequestId)).toBe(false);
    expect(isLatestSnapshotRequest(latestRequestId, latestRequestId)).toBe(
      true
    );
  });

  it("never presents driver A's plan while driver B is loading or after B fails", () => {
    expect(
      resolveDriverPlanStatus({
        selectedDriverId: "driver-b",
        stateDriverId: "driver-a",
        stateStatus: "READY",
        responseDriverId: "driver-a"
      })
    ).toBe("LOADING");

    expect(
      resolveDriverPlanStatus({
        selectedDriverId: "driver-b",
        stateDriverId: "driver-b",
        stateStatus: "ERROR"
      })
    ).toBe("ERROR");
  });

  it("retries an order detail after failure and stops only after valid detail is cached", () => {
    const assignmentId = "assignment-current";
    let cachedAssignmentId: string | undefined;

    expect(
      shouldFetchOrderDetail(assignmentId, cachedAssignmentId)
    ).toBe(true);
    // The failed request does not populate the cache, so the next poll retries.
    expect(
      shouldFetchOrderDetail(assignmentId, cachedAssignmentId)
    ).toBe(true);

    cachedAssignmentId = assignmentId;
    expect(
      shouldFetchOrderDetail(assignmentId, cachedAssignmentId)
    ).toBe(false);
  });

  it("only accepts detail data for the snapshot's current assignment", () => {
    const currentOrder = order({ currentAssignmentId: "assignment-new" });

    expect(
      isCurrentAssignmentDetail(currentOrder, {
        currentAssignment: { id: "assignment-old" }
      })
    ).toBe(false);
    expect(
      isCurrentAssignmentDetail(currentOrder, {
        currentAssignment: { id: "assignment-new" }
      })
    ).toBe(true);
    expect(
      isCurrentAssignmentDetail(order({ currentAssignmentId: undefined }), {
        currentAssignment: { id: "assignment-old" }
      })
    ).toBe(false);
  });

  it("shows occupied work and every idle gap across a 12-hour window starting one hour before now", () => {
    const gantt = buildDriverGantt(
      [
        {
          slot: "A",
          orderId: "order-a",
          orderNo: "RCD-A",
          businessType: "DOOR_DELIVERY",
          feasibility: "NORMAL",
          assignment: assignment({
            id: "assignment-a",
            orderId: "order-a",
            sequenceNo: 1,
            slot: "A",
            plannedDepartAt: "2026-08-18T14:00:00.000Z",
            plannedPickupAt: "2026-08-18T14:20:00.000Z",
            plannedCompleteAt: "2026-08-18T15:10:00.000Z"
          })
        },
        {
          slot: "B",
          orderId: "order-b",
          orderNo: "RCD-B",
          businessType: "STORE_RETURN",
          feasibility: "AT_RISK",
          assignment: assignment({
            id: "assignment-b",
            orderId: "order-b",
            sequenceNo: 2,
            slot: "B",
            plannedDepartAt: "2026-08-18T16:00:00.000Z",
            plannedPickupAt: "2026-08-18T16:30:00.000Z",
            plannedCompleteAt: "2026-08-18T17:30:00.000Z"
          })
        }
      ],
      Date.parse("2026-08-18T13:45:00.000Z")
    );

    expect(gantt.windowStartMs).toBe(
      Date.parse("2026-08-18T12:00:00.000Z")
    );
    expect(gantt.windowEndMs - gantt.windowStartMs).toBe(12 * 60 * 60 * 1_000);
    expect(gantt.focusOffsetMinutes).toBe(60);
    expect(
      gantt.blocks
        .filter((block) => block.orderId)
        .map((block) => block.orderId)
    ).toEqual([
      "order-a",
      "order-a",
      "order-a",
      "order-b",
      "order-b",
      "order-b"
    ]);
    expect(
      gantt.blocks
        .filter((block) => block.kind === "IDLE")
        .map((block) => block.durationMinutes)
    ).toEqual([120, 50, 390]);
    expect(
      gantt.blocks
        .filter((block) => block.orderId)
        .map((block) => [block.orderId, block.businessType])
    ).toEqual([
      ["order-a", "DOOR_DELIVERY"],
      ["order-a", "DOOR_DELIVERY"],
      ["order-a", "DOOR_DELIVERY"],
      ["order-b", "STORE_RETURN"],
      ["order-b", "STORE_RETURN"],
      ["order-b", "STORE_RETURN"]
    ]);
  });

  it("shows the full 12-hour window as idle when a driver has no plan", () => {
    const gantt = buildDriverGantt([], Date.parse("2026-08-18T08:45:00.000Z"));

    expect(gantt.windowStartMs).toBe(
      Date.parse("2026-08-18T07:00:00.000Z")
    );
    expect(gantt.blocks).toEqual([
      expect.objectContaining({
        kind: "IDLE",
        durationMinutes: 12 * 60
      })
    ]);
  });

  it("does not paint idle while the selected driver's plan is loading or failed", () => {
    const gantt = buildDriverGantt(
      [],
      Date.parse("2026-08-18T08:45:00.000Z"),
      "UNKNOWN"
    );

    expect(gantt.blocks).toEqual([]);
  });

  it("never paints stale planned times as numeric ETA blocks when ETA is unavailable", () => {
    const gantt = buildDriverGantt(
      [
        {
          slot: "A",
          orderId: "order-stale",
          orderNo: "RCD-STALE",
          businessType: "DOOR_DELIVERY",
          feasibility: "AT_RISK",
          assignment: assignment({
            id: "assignment-stale",
            orderId: "order-stale",
            etaAvailable: false,
            etaUnavailableReason: "LOCATION_STALE",
            deadheadEtaMinutes: 20,
            serviceEtaMinutes: 35,
            plannedDepartAt: "2026-08-18T09:10:00.000Z",
            plannedPickupAt: "2026-08-18T09:30:00.000Z",
            plannedCompleteAt: "2026-08-18T10:20:00.000Z"
          })
        }
      ],
      Date.parse("2026-08-18T08:45:00.000Z")
    );

    expect(
      gantt.blocks.filter((block) => block.orderId === "order-stale")
    ).toHaveLength(0);
    expect(gantt.blocks.filter((block) => block.kind === "IDLE")).toHaveLength(
      0
    );
    expect(gantt.unavailableRows).toEqual([
      expect.objectContaining({
        orderId: "order-stale",
        unavailableReason: "LOCATION_STALE"
      })
    ]);
  });

  it("keeps the ETA warning when unavailable plan timestamps are absent", () => {
    const gantt = buildDriverGantt(
      [
        {
          slot: "A",
          orderId: "order-without-plan",
          orderNo: "RCD-NO-PLAN",
          assignment: assignment({
            id: "assignment-without-plan",
            orderId: "order-without-plan",
            etaAvailable: false,
            etaUnavailableReason: "AMAP_UNAVAILABLE",
            plannedDepartAt: undefined,
            plannedPickupAt: undefined,
            plannedCompleteAt: undefined
          })
        }
      ],
      Date.parse("2026-08-18T08:45:00.000Z")
    );

    expect(gantt.blocks.filter((block) => block.orderId)).toHaveLength(0);
    expect(gantt.blocks.filter((block) => block.kind === "IDLE")).toHaveLength(
      0
    );
    expect(gantt.unavailableRows).toEqual([
      expect.objectContaining({
        orderId: "order-without-plan",
        unavailableReason: "AMAP_UNAVAILABLE"
      })
    ]);
  });

  it("does not claim full idle when an assignment has unknown plan timestamps", () => {
    const gantt = buildDriverGantt(
      [
        {
          slot: "A",
          orderId: "order-unknown-time",
          orderNo: "RCD-UNKNOWN-TIME",
          assignment: assignment({
            id: "assignment-unknown-time",
            orderId: "order-unknown-time",
            etaAvailable: true,
            plannedDepartAt: undefined
          })
        }
      ],
      Date.parse("2026-08-18T08:45:00.000Z")
    );

    expect(gantt.blocks).toEqual([]);
    expect(gantt.unavailableRows).toEqual([
      expect.objectContaining({
        orderId: "order-unknown-time"
      })
    ]);
  });

  it("does not claim idle when a planned slot has no matching assignment detail", () => {
    const gantt = buildDriverGantt(
      [
        {
          slot: "A",
          orderId: "order-missing-detail",
          orderNo: "RCD-MISSING-DETAIL"
        }
      ],
      Date.parse("2026-08-18T08:45:00.000Z")
    );

    expect(gantt.blocks).toEqual([]);
    expect(gantt.unavailableRows).toEqual([
      expect.objectContaining({
        orderId: "order-missing-detail"
      })
    ]);
  });

  it("hides G3E2E evidence orders without mutating the source snapshot", () => {
    const source = [
      order(),
      order({ id: "hidden", orderNo: "[G3E2E] evidence" })
    ];

    expect(filterVisibleOrders(source).map((item) => item.id)).toEqual([
      "order-1"
    ]);
    expect(source).toHaveLength(2);
  });

  it("maps all four business types to the matching pickup or return time label", () => {
    expect(ORDER_BUSINESS_META).toEqual({
      STORE_PICKUP: {
        label: "门店取车",
        timeLabel: "取车时间",
        visualKind: "PICKUP"
      },
      STORE_RETURN: {
        label: "门店还车",
        timeLabel: "还车时间",
        visualKind: "RETURN"
      },
      DOOR_DELIVERY: {
        label: "送车上门",
        timeLabel: "取车时间",
        visualKind: "PICKUP"
      },
      DOOR_PICKUP: {
        label: "上门取车",
        timeLabel: "还车时间",
        visualKind: "RETURN"
      }
    });
  });

  it.each([
    ["STORE_PICKUP", "PICKUP", "order-pickup", [121.47, 31.23]],
    ["DOOR_DELIVERY", "PICKUP", "order-pickup", [121.47, 31.23]],
    ["STORE_RETURN", "RETURN", "order-return", [121.48, 31.24]],
    ["DOOR_PICKUP", "RETURN", "order-return", [121.48, 31.24]]
  ] as const)(
    "uses one current map point for %s",
    (businessType, visualKind, markerKind, position) => {
      expect(resolveOrderMapPoint(order({ businessType }))).toMatchObject({
        visualKind,
        markerKind,
        position
      });
    }
  );

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "hides %s orders from the active map",
    (executionStatus) => {
      expect(resolveOrderMapPoint(order({ executionStatus }))).toBeNull();
    }
  );

  it("does not invent a map point when the required coordinates are absent", () => {
    expect(
      resolveOrderMapPoint(
        order({ businessType: "STORE_RETURN", deliveryLat: undefined })
      )
    ).toBeNull();
  });

  it("searches orders by business type and Shanghai pickup or return time", () => {
    const source = order({
      businessType: "STORE_RETURN",
      promisedPickupAt: "2026-08-18T14:49:00.000Z"
    });

    expect(orderMatchesKeyword(source, "门店还车")).toBe(true);
    expect(orderMatchesKeyword(source, "还车时间")).toBe(true);
    expect(orderMatchesKeyword(source, "08/18 22:49")).toBe(true);
    expect(orderMatchesKeyword(source, "08-18 22:49")).toBe(true);
  });

  it("pins risk orders and sorts remaining orders from earliest to latest", () => {
    const source = [
      order({
        id: "late",
        orderNo: "RCD-LATE",
        promisedPickupAt: "2026-08-18T12:00:00.000Z"
      }),
      order({
        id: "risk",
        orderNo: "RCD-RISK",
        feasibility: "INFEASIBLE",
        promisedPickupAt: "2026-08-18T13:00:00.000Z"
      }),
      order({
        id: "early",
        orderNo: "RCD-EARLY",
        promisedPickupAt: "2026-08-18T10:00:00.000Z"
      })
    ];

    expect(sortOrdersForDispatchList(source).map((item) => item.id)).toEqual([
      "risk",
      "early",
      "late"
    ]);
    expect(source.map((item) => item.id)).toEqual(["late", "risk", "early"]);
  });

  it("searches drivers by name, store code, or store name without mutating the snapshot", () => {
    const source = [
      driver(),
      driver({ id: "driver-2", name: "李师傅", storeCode: "HGH-02" })
    ];
    const stores = new Map([
      ["SHA-01", "上海虹桥店"],
      ["HGH-02", "杭州西湖店"]
    ]);

    expect(
      filterDriversByKeyword(source, "西湖", stores).map((item) => item.id)
    ).toEqual(["driver-2"]);
    expect(
      filterDriversByKeyword(source, "sha-01", stores).map((item) => item.id)
    ).toEqual(["driver-1"]);
    expect(
      filterDriversByKeyword(source, "王师傅", stores).map((item) => item.id)
    ).toEqual(["driver-1"]);
    expect(source.map((item) => item.id)).toEqual(["driver-1", "driver-2"]);
  });

  it("builds idle, deadhead, fixed-module, and order-drive segments from frozen fields", () => {
    const segments = buildTimelineSegments({
      assignment: assignment(),
      cursorAt: "2026-08-16T09:00:00.000Z"
    });

    expect(segments.map((segment) => segment.kind)).toEqual([
      "IDLE",
      "DEADHEAD",
      "SERVICE_MODULES",
      "ORDER_DRIVE"
    ]);
    expect(segments.map((segment) => segment.minutes)).toEqual([
      10, 20, 15, 35
    ]);
  });

  it("never reuses stale numeric ETA when the API marks ETA unavailable", () => {
    const segments = buildTimelineSegments({
      assignment: assignment({
        etaAvailable: false,
        etaUnavailableReason: "LOCATION_STALE",
        deadheadEtaMinutes: 20,
        serviceEtaMinutes: 35
      }),
      cursorAt: "2026-08-16T09:00:00.000Z"
    });

    expect(
      segments.find((segment) => segment.kind === "DEADHEAD")
    ).toMatchObject({
      minutes: null,
      unavailableReason: "LOCATION_STALE"
    });
    expect(
      segments.find((segment) => segment.kind === "ORDER_DRIVE")
    ).toMatchObject({
      minutes: null,
      unavailableReason: "LOCATION_STALE"
    });
  });

  it("links an assigned order back to its driver slot", () => {
    expect(
      resolveAssignedDriverId("order-1", [
        {
          id: "driver-1",
          name: "王师傅",
          storeCode: "SHA-01",
          onShift: true,
          availability: "AVAILABLE",
          planVersion: 4,
          locationFreshness: "FRESH",
          slots: {
            A: {
              id: "assignment-1",
              orderId: "order-1",
              orderNo: "RCD-001",
              executionStatus: "PLANNED",
              slot: "A",
              lockType: "MANUAL_LOCKED"
            }
          }
        }
      ])
    ).toBe("driver-1");
  });

  it.each([
    ["STORE_PICKUP", "pickupAt"],
    ["DOOR_DELIVERY", "pickupAt"],
    ["STORE_RETURN", "returnAt"],
    ["DOOR_PICKUP", "returnAt"]
  ] as const)("maps %s promise time to %s", (businessType, expectedField) => {
    const promisedPickupAt = "2026-08-18T12:00:00.000Z";
    const result = resolveOrderPromiseTimes(
      order({ businessType, promisedPickupAt })
    );

    expect(result[expectedField]).toBe(promisedPickupAt);
    expect(
      result[expectedField === "pickupAt" ? "returnAt" : "pickupAt"]
    ).toBeUndefined();
  });
});

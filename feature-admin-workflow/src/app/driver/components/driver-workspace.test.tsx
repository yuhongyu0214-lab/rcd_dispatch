import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DriverWorkspaceData } from "./driver-h5-entry";

import {
  DRIVER_MAP_FALLBACK_CLASS,
  DRIVER_MAP_MARKER_PALETTES,
  DriverMap,
  createDriverMapMarkerStore,
  syncDriverMapMarkers
} from "./driver-map";

import {
  createLatestResponseGate,
  DRIVER_ACCESSIBLE_COLOR_CLASSES,
  DriverWorkspace
} from "./driver-workspace";

vi.stubGlobal("React", React);

const data: DriverWorkspaceData = {
  drivers: [
    {
      id: "driver-self",
      name: "司机甲",
      storeCode: "STORE-1",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 2,
      locationFreshness: "STALE",
      lastLocation: {
        lat: 31.23,
        lng: 121.47,
        accuracyMeters: 12,
        capturedAt: "2026-08-16T08:00:00.000Z"
      },
      slots: {}
    }
  ],
  tasks: [
    {
      id: "assignment-1",
      orderId: "order-1",
      orderNo: "ORDER-1",
      businessType: "DOOR_DELIVERY",
      executionStatus: "PLANNED",
      slot: "A",
      lockType: "MANUAL_LOCKED",
      feasibility: "NORMAL",
      promisedPickupAt: "2026-08-16T09:00:00.000Z",
      pickupPoint: { lat: 31.24, lng: 121.48 },
      pickupAddress: "取车点",
      servicePlan: null
    }
  ],
  unassignedOrders: [
    {
      orderId: "order-u",
      orderNo: "ORDER-U",
      businessType: "STORE_RETURN",
      executionStatus: "UNASSIGNED",
      slot: "NONE",
      lockType: "NONE",
      feasibility: "AT_RISK",
      promisedPickupAt: "2026-08-16T10:00:00.000Z",
      deliveryPoint: { lat: 31.25, lng: 121.49 },
      deliveryAddress: "送达点"
    }
  ]
};

describe("driver H5 workspace", () => {
  it("updates map markers in place without fitting the viewport again", () => {
    const map = {
      destroy: vi.fn(),
      setFitView: vi.fn(),
      setZoomAndCenter: vi.fn()
    };
    const createContent = vi.fn(() => ({}) as HTMLElement);
    const createdMarkers: Array<{
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
      setMap: ReturnType<typeof vi.fn>;
      setPosition: ReturnType<typeof vi.fn>;
      setContent: ReturnType<typeof vi.fn>;
      setzIndex: ReturnType<typeof vi.fn>;
    }> = [];
    const createMarker = vi.fn(() => {
      const marker = {
        on: vi.fn(),
        off: vi.fn(),
        setMap: vi.fn(),
        setPosition: vi.fn(),
        setContent: vi.fn(),
        setzIndex: vi.fn()
      };
      createdMarkers.push(marker);
      return marker;
    });
    const markerStore = createDriverMapMarkerStore();
    const firstMarkers = [
      {
        id: "driver-1",
        kind: "driver" as const,
        label: "司机甲",
        lat: 31.23,
        lng: 121.47
      },
      {
        id: "task-1",
        kind: "task" as const,
        label: "订单甲",
        lat: 31.24,
        lng: 121.48
      }
    ];

    expect(
      syncDriverMapMarkers({
        map,
        markerStore,
        markers: firstMarkers,
        selectedId: null,
        onSelect: vi.fn(),
        createMarker,
        createContent,
        initializeView: true
      })
    ).toBe(true);
    expect(createMarker).toHaveBeenCalledTimes(2);
    expect(map.setFitView).toHaveBeenCalledTimes(1);

    expect(
      syncDriverMapMarkers({
        map,
        markerStore,
        markers: [
          { ...firstMarkers[0], lat: 31.231 },
          {
            id: "unassigned-1",
            kind: "unassigned",
            label: "待分配订单",
            lat: 31.25,
            lng: 121.49
          }
        ],
        selectedId: "driver-1",
        onSelect: vi.fn(),
        createMarker,
        createContent,
        initializeView: false
      })
    ).toBe(false);

    expect(createMarker).toHaveBeenCalledTimes(3);
    expect(createdMarkers[0].setPosition).toHaveBeenCalledWith([
      121.47, 31.231
    ]);
    expect(createdMarkers[1].setMap).toHaveBeenLastCalledWith(null);
    expect(map.setFitView).toHaveBeenCalledTimes(1);
    expect(map.destroy).not.toHaveBeenCalled();

    const singleMarkerMap = {
      destroy: vi.fn(),
      setFitView: vi.fn(),
      setZoomAndCenter: vi.fn()
    };
    syncDriverMapMarkers({
      map: singleMarkerMap,
      markerStore: createDriverMapMarkerStore(),
      markers: [firstMarkers[0]],
      selectedId: null,
      onSelect: vi.fn(),
      createMarker,
      createContent,
      initializeView: true
    });
    expect(singleMarkerMap.setZoomAndCenter).toHaveBeenCalledWith(
      13,
      [121.47, 31.23]
    );
  });

  it("uses semantic high-contrast marker palettes and fallback text", () => {
    expect(DRIVER_MAP_MARKER_PALETTES.staleDriver).toEqual({
      background: "var(--muted)",
      foreground: "var(--surface)"
    });
    expect(DRIVER_MAP_MARKER_PALETTES.unassigned).toEqual({
      background: "var(--warning)",
      foreground: "var(--accent-ink)"
    });
    expect(DRIVER_MAP_FALLBACK_CLASS).toContain("bg-[var(--panel)]");
    expect(DRIVER_MAP_FALLBACK_CLASS).toContain("text-[var(--text-primary)]");

    const html = renderToStaticMarkup(
      <DriverMap
        markers={[]}
        selectedId={null}
        amapKey=""
        amapSecurityCode=""
        onSelect={vi.fn()}
      />
    );
    expect(html).toContain("地图暂不可用，任务列表仍可正常操作");
    expect(html).toContain("text-[var(--text-primary)]");
  });

  it("renders V2 execution without accept, reject or reassign controls", () => {
    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey="public-js-key"
        amapSecurityCode="public-security-code"
        initialData={data}
      />
    );

    expect(html).toContain("出发并导航");
    expect(html).toContain("未分配订单");
    expect(html).not.toContain("接单");
    expect(html).not.toContain("拒单");
    expect(html).not.toContain("改派");
  });

  it("keeps the mobile shell horizontally contained with 44px controls", () => {
    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey=""
        amapSecurityCode=""
        initialData={data}
      />
    );

    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("h-dvh");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("min-w-0");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("AMAP_SERVER_KEY");
  });

  it("prevents an older refresh response from replacing newer workspace data", () => {
    const gate = createLatestResponseGate();
    const firstRequest = gate.beginRequest();
    const secondRequest = gate.beginRequest();
    const committed: string[] = [];

    expect(
      gate.commitIfLatest(secondRequest, () => committed.push("newer"))
    ).toBe(true);
    expect(
      gate.commitIfLatest(firstRequest, () => committed.push("older"))
    ).toBe(false);
    expect(committed).toEqual(["newer"]);
  });

  it("provides a standalone keyboard control for selecting a task on the map", () => {
    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey=""
        amapSecurityCode=""
        initialData={data}
      />
    );

    expect(html).toContain("在地图查看");
    expect(html).toContain('aria-pressed="false"');
  });

  it("uses existing semantic tokens for workspace colors, surfaces and borders", () => {
    expect(DRIVER_ACCESSIBLE_COLOR_CLASSES).toEqual({
      unassignedActive: "bg-[var(--warning)] text-[var(--accent-ink)]",
      completeAction: "bg-[var(--success)] text-[var(--surface)]"
    });

    const source = readFileSync(
      new URL("./driver-workspace.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("bg-[var(--bg)]");
    expect(source).toContain("bg-[var(--surface)]");
    expect(source).toContain("border-[var(--line)]");
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring|accent)-(?:slate|blue|amber|emerald|rose|white|black)(?:-\d+|\/\d+)?\b/
    );
  });

  it("marks stale positions with explicit text rather than color alone", () => {
    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey=""
        amapSecurityCode=""
        initialData={data}
      />
    );

    expect(html).toContain("位置已过期");
  });

  it("renders every frozen feasibility state with its own wording", () => {
    const tasks = [
      ["NORMAL", "时效正常"],
      ["AT_RISK", "存在迟到风险"],
      ["INFEASIBLE", "当前计划不可行"],
      ["UNKNOWN", "时效尚未评估"]
    ].map(([feasibility], index) => ({
      ...data.tasks[0],
      id: `assignment-${index}`,
      orderId: `order-${index}`,
      orderNo: `ORDER-${index}`,
      feasibility: feasibility as (typeof data.tasks)[number]["feasibility"]
    }));

    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey=""
        amapSecurityCode=""
        initialData={{ ...data, tasks }}
      />
    );

    for (const [, label] of [
      ["NORMAL", "时效正常"],
      ["AT_RISK", "存在迟到风险"],
      ["INFEASIBLE", "当前计划不可行"],
      ["UNKNOWN", "时效尚未评估"]
    ]) {
      expect(html).toContain(label);
    }
  });

  it("renders an ended shift with GPS stopped and the end button disabled", () => {
    const html = renderToStaticMarkup(
      <DriverWorkspace
        driverId="driver-self"
        driverName="司机甲"
        amapKey=""
        amapSecurityCode=""
        initialData={{
          ...data,
          drivers: data.drivers.map((driver) => ({
            ...driver,
            onShift: false
          })),
          tasks: []
        }}
      />
    );

    expect(html).toContain("定位已停止");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>已下班<\/button>/);
  });
});

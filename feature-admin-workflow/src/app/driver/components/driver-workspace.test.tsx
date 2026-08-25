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

type Rgb = [number, number, number];

function parseOklchToken(css: string, token: string): Rgb {
  const match = css.match(
    new RegExp(`--${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`)
  );
  if (!match) throw new Error(`Missing OKLCH token: --${token}`);

  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hueRadians = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];

  return linear.map((channel) => {
    const encoded =
      channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, encoded));
  }) as Rgb;
}

function mixSrgb(first: Rgb, second: Rgb, firstWeight: number): Rgb {
  return first.map(
    (channel, index) =>
      channel * firstWeight + second[index] * (1 - firstWeight)
  ) as Rgb;
}

function relativeLuminance(color: Rgb) {
  const [red, green, blue] = color.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

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
      completeAction: "bg-[var(--success)] text-[var(--ink)]",
      freshLocationText:
        "text-[color-mix(in_srgb,var(--success)_70%,var(--ink))]",
      staleLocationText:
        "text-[color-mix(in_srgb,var(--danger)_70%,var(--ink))]",
      warningText: "text-[color-mix(in_srgb,var(--warning)_60%,var(--ink))]",
      infoText: "text-[color-mix(in_srgb,var(--info)_70%,var(--ink))]",
      helperText: "text-[var(--text-secondary)]",
      disabledHelperText: "disabled:text-[var(--text-secondary)]"
    });

    const source = readFileSync(
      new URL("./driver-workspace.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("bg-[var(--bg)]");
    expect(source).toContain("bg-[var(--surface)]");
    expect(source).toContain("border-[var(--line)]");
    expect(source).toContain("bg-[var(--success)]");
    expect(source).toContain(
      "bg-[color-mix(in_srgb,var(--panel)_50%,var(--surface))]"
    );
    expect(source).toContain(
      "bg-[color-mix(in_srgb,var(--warning)_17%,var(--surface))]"
    );
    expect(source).toContain(
      "bg-[color-mix(in_srgb,var(--info)_13%,var(--surface))]"
    );
    for (const className of [
      "completeAction",
      "freshLocationText",
      "staleLocationText",
      "warningText",
      "infoText",
      "helperText",
      "disabledHelperText"
    ]) {
      expect(source).toContain(`DRIVER_ACCESSIBLE_COLOR_CLASSES.${className}`);
    }
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring|accent)-(?:slate|blue|amber|emerald|rose|white|black)(?:-\d+|\/\d+)?\b/
    );
  });

  it("keeps every small semantic text combination at WCAG AA contrast", () => {
    const css = readFileSync(
      new URL("../../globals.css", import.meta.url),
      "utf8"
    );
    const token = (name: string) => parseOklchToken(css, name);
    const surface = token("surface");
    const panel = token("panel");
    const pageBackground = token("bg");
    const ink = token("ink");
    const success = token("success");
    const warning = token("warning");
    const danger = token("danger");
    const info = token("info");
    const accentInk = token("accent-ink");
    const secondary = token("text-secondary");
    const mixedPanel = mixSrgb(panel, surface, 0.5);
    const warningSurface = mixSrgb(warning, surface, 0.17);
    const infoSurface = mixSrgb(info, surface, 0.13);
    const ratios = {
      completeAction: contrastRatio(ink, success),
      unassignedActive: contrastRatio(accentInk, warning),
      freshLocation: contrastRatio(mixSrgb(success, ink, 0.7), mixedPanel),
      staleLocation: contrastRatio(mixSrgb(danger, ink, 0.7), mixedPanel),
      warningText: contrastRatio(mixSrgb(warning, ink, 0.6), warningSurface),
      infoText: contrastRatio(mixSrgb(info, ink, 0.7), infoSurface),
      helperOnSurface: contrastRatio(secondary, surface),
      helperOnMixedPanel: contrastRatio(secondary, mixedPanel),
      helperOnPageBackground: contrastRatio(secondary, pageBackground)
    };

    for (const [name, ratio] of Object.entries(ratios)) {
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
    }
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

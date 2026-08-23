"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DriverV2, OrderV2 } from "@/types/v2";

import { resolveOrderMapPoint } from "./dispatcher-console-model";
import styles from "./dispatcher-console.module.css";

type ConsoleAmapMarker = {
  setMap: (map: ConsoleAmapMap | null) => void;
  on: (eventName: "click", handler: () => void) => void;
};

type ConsoleAmapMap = {
  destroy: () => void;
  off: (
    eventName: "dragstart" | "mousewheel",
    handler: () => void
  ) => void;
  on: (
    eventName: "dragstart" | "mousewheel",
    handler: () => void
  ) => void;
  setCenter: (center: [number, number]) => void;
  setFitView: (overlays?: ConsoleAmapMarker[]) => void;
  setZoomAndCenter: (
    zoom: number,
    center: [number, number],
    immediately?: boolean,
    duration?: number
  ) => void;
};

type ConsoleAmapNamespace = {
  Map: new (
    container: HTMLDivElement,
    options: {
      center: [number, number];
      zoom: number;
      resizeEnable: boolean;
      viewMode: "2D";
      mapStyle: string;
    }
  ) => ConsoleAmapMap;
  Marker: new (options: {
    position: [number, number];
    content: HTMLElement;
    anchor: "center" | "bottom-center";
  }) => ConsoleAmapMarker;
};

type DispatcherWindow = Window & {
  AMap?: ConsoleAmapNamespace;
  _AMapSecurityConfig?: { securityJsCode: string };
  rcdDispatcherAmapLoader?: Promise<ConsoleAmapNamespace>;
};

type MapStatus = "idle" | "loading" | "ready" | "missing" | "error";

type MapFocusTarget = {
  key: string;
  position: [number, number];
  zoom: number;
};

export type DispatcherMapSelection = {
  kind: "driver" | "order";
  id: string;
};

type MapMarkerRecord = MapFocusTarget & {
  marker: ConsoleAmapMarker;
  content: HTMLElement;
  selection: DispatcherMapSelection;
};

const DEFAULT_CENTER: [number, number] = [121.4737, 31.2304];
const DRIVER_FOCUS_ZOOM = 15;
const ORDER_FOCUS_ZOOM = 16;
const MAP_FOCUS_DURATION_MS = 500;
const MAP_FOCUS_LOCK_MS = MAP_FOCUS_DURATION_MS + 80;

function loadAmap(amapKey: string, securityCode?: string) {
  const browserWindow = window as DispatcherWindow;
  if (browserWindow.AMap) return Promise.resolve(browserWindow.AMap);
  if (securityCode) {
    browserWindow._AMapSecurityConfig = { securityJsCode: securityCode };
  }
  if (!browserWindow.rcdDispatcherAmapLoader) {
    browserWindow.rcdDispatcherAmapLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}`;
      script.async = true;
      script.onload = () => {
        if (browserWindow.AMap) {
          resolve(browserWindow.AMap);
        } else {
          reject(new Error("AMap unavailable after script load"));
        }
      };
      script.onerror = () => reject(new Error("AMap script failed to load"));
      document.head.appendChild(script);
    });
  }
  return browserWindow.rcdDispatcherAmapLoader;
}

function toPosition(lat?: number, lng?: number): [number, number] | null {
  const valid =
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  return valid ? [lng, lat] : null;
}

function orderMarkerClass(order: OrderV2) {
  if (order.feasibility === "INFEASIBLE") return styles.mapMarkerDanger;
  if (order.feasibility === "AT_RISK") return styles.mapMarkerWarning;
  if (order.feasibility === "UNKNOWN") return styles.mapMarkerUnknown;
  return "";
}

function driverMarkerClass(driver: DriverV2) {
  return driver.onShift && driver.availability === "AVAILABLE"
    ? styles.mapMarkerDriverIdle
    : styles.mapMarkerDriverOther;
}

function driverFreshnessClass(driver: DriverV2) {
  return driver.locationFreshness === "FRESH"
    ? ""
    : styles.mapMarkerLocationStale;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>
) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value);
  }
  return element;
}

function createDriverMarkerIcon() {
  const icon = svgElement("svg", {
    viewBox: "0 0 20 20",
    class: styles.mapMarkerDriverIcon,
    "aria-hidden": "true",
    focusable: "false"
  });
  icon.append(
    svgElement("circle", {
      cx: "10",
      cy: "10",
      r: "9",
      fill: "currentColor",
      stroke: "white",
      "stroke-width": "1.2"
    }),
    svgElement("circle", {
      cx: "10",
      cy: "6.65",
      r: "3.05",
      fill: "white"
    }),
    svgElement("path", {
      d: "M4.45 15.6c.55-3.03 2.69-4.86 5.55-4.86s5 1.83 5.55 4.86A7.5 7.5 0 0 1 10 18a7.5 7.5 0 0 1-5.55-2.4Z",
      fill: "white"
    })
  );
  return icon;
}

function createOrderMarkerIcon() {
  const icon = svgElement("svg", {
    viewBox: "0 0 15 15",
    class: styles.mapMarkerOrderIcon,
    "aria-hidden": "true",
    focusable: "false"
  });
  icon.append(
    svgElement("path", {
      d: "M7.5 14C6.65 12.4 2.1 8.82 2.1 5.72a5.4 5.4 0 1 1 10.8 0C12.9 8.82 8.35 12.4 7.5 14Z",
      fill: "currentColor"
    }),
    svgElement("circle", {
      cx: "7.5",
      cy: "5.55",
      r: "1.85",
      fill: "white"
    })
  );
  return icon;
}

function freshnessLabel(driver: DriverV2) {
  return {
    FRESH: "位置实时",
    STALE: "位置已过期",
    NONE: "暂无位置"
  }[driver.locationFreshness];
}

export function DispatcherConsoleMap({
  amapKey,
  amapSecurityCode,
  drivers,
  orders,
  selection,
  onSelectDriver,
  onSelectOrder
}: {
  amapKey: string;
  amapSecurityCode?: string;
  drivers: readonly DriverV2[];
  orders: readonly OrderV2[];
  selection: DispatcherMapSelection | null;
  onSelectDriver: (driverId: string) => void;
  onSelectOrder: (orderId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<ConsoleAmapMap | null>(null);
  const markersRef = useRef<MapMarkerRecord[]>([]);
  const selectionRef = useRef(selection);
  const onSelectDriverRef = useRef(onSelectDriver);
  const onSelectOrderRef = useRef(onSelectOrder);
  const fittedRef = useRef(false);
  const focusedMarkerKeyRef = useRef<string | null>(null);
  const mapManuallyMovedRef = useRef(false);
  const mapFocusTransitionRef = useRef(false);
  const pendingMapFocusRef = useRef<MapFocusTarget | null>(null);
  const mapFocusTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<MapStatus>("idle");

  selectionRef.current = selection;
  onSelectDriverRef.current = onSelectDriver;
  onSelectOrderRef.current = onSelectOrder;

  const resetMapFocus = useCallback(() => {
    focusedMarkerKeyRef.current = null;
    mapManuallyMovedRef.current = true;
    mapFocusTransitionRef.current = false;
    pendingMapFocusRef.current = null;
    if (mapFocusTimerRef.current !== null) {
      window.clearTimeout(mapFocusTimerRef.current);
      mapFocusTimerRef.current = null;
    }
  }, []);

  const focusMapTarget = useCallback(function focusTarget(
    target: MapFocusTarget
  ) {
    const map = mapRef.current;
    if (!map) return;

    const alreadyFocused =
      focusedMarkerKeyRef.current === target.key &&
      !mapManuallyMovedRef.current;
    if (alreadyFocused) {
      pendingMapFocusRef.current = null;
      return;
    }
    if (mapFocusTransitionRef.current) {
      pendingMapFocusRef.current = target;
      return;
    }

    focusedMarkerKeyRef.current = target.key;
    mapManuallyMovedRef.current = false;
    mapFocusTransitionRef.current = true;
    map.setZoomAndCenter(
      target.zoom,
      target.position,
      false,
      MAP_FOCUS_DURATION_MS
    );
    mapFocusTimerRef.current = window.setTimeout(() => {
      mapFocusTransitionRef.current = false;
      mapFocusTimerRef.current = null;
      const pendingTarget = pendingMapFocusRef.current;
      pendingMapFocusRef.current = null;
      if (pendingTarget) focusTarget(pendingTarget);
    }, MAP_FOCUS_LOCK_MS);
  }, []);

  useEffect(() => {
    if (!amapKey) {
      setStatus("missing");
      return;
    }
    if (!containerRef.current) return;
    let cancelled = false;
    let map: ConsoleAmapMap | null = null;
    const handleManualViewChange = () => resetMapFocus();
    setStatus("loading");
    void loadAmap(amapKey, amapSecurityCode)
      .then((amap) => {
        if (cancelled || !containerRef.current) return;
        map = new amap.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 11,
          resizeEnable: true,
          viewMode: "2D",
          mapStyle: "amap://styles/normal"
        });
        map.on("dragstart", handleManualViewChange);
        map.on("mousewheel", handleManualViewChange);
        mapRef.current = map;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      resetMapFocus();
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      markersRef.current = [];
      map?.off("dragstart", handleManualViewChange);
      map?.off("mousewheel", handleManualViewChange);
      map?.destroy();
      mapRef.current = null;
    };
  }, [amapKey, amapSecurityCode, resetMapFocus]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const amap = (window as DispatcherWindow).AMap;
    if (!amap) return;
    markersRef.current.forEach(({ marker }) => marker.setMap(null));
    const markers: MapMarkerRecord[] = [];

    const isSelected = (candidate: DispatcherMapSelection) =>
      selectionRef.current?.kind === candidate.kind &&
      selectionRef.current.id === candidate.id;

    for (const driver of drivers) {
      const location = driver.lastLocation;
      const position = location
        ? toPosition(location.lat, location.lng)
        : null;
      if (!position) continue;
      const content = document.createElement("div");
      content.className = `${styles.mapMarker} ${styles.mapMarkerDriver} ${driverMarkerClass(
        driver
      )} ${driverFreshnessClass(driver)}`;
      content.dataset.markerKind = "driver";
      content.dataset.driverId = driver.id;
      content.dataset.selected = isSelected({ kind: "driver", id: driver.id })
        ? "true"
        : "false";
      content.classList.toggle(
        styles.mapMarkerSelected,
        isSelected({ kind: "driver", id: driver.id })
      );
      content.append(createDriverMarkerIcon());
      content.title = `${driver.name} · ${freshnessLabel(driver)}`;
      const marker = new amap.Marker({
        position,
        content,
        anchor: "center"
      });
      marker.on("click", () => {
        focusMapTarget({
          key: `driver:${driver.id}`,
          position,
          zoom: DRIVER_FOCUS_ZOOM
        });
        onSelectDriverRef.current(driver.id);
      });
      marker.setMap(mapRef.current);
      markers.push({
        marker,
        content,
        key: `driver:${driver.id}`,
        position,
        zoom: DRIVER_FOCUS_ZOOM,
        selection: { kind: "driver", id: driver.id }
      });
    }

    for (const order of orders) {
      const point = resolveOrderMapPoint(order);
      if (!point) continue;
      const content = document.createElement("div");
      content.className = `${styles.mapMarker} ${styles.mapMarkerOrder} ${
        point.visualKind === "PICKUP"
          ? styles.mapMarkerPickup
          : styles.mapMarkerDelivery
      } ${orderMarkerClass(order)}`;
      content.dataset.markerKind = point.markerKind;
      content.dataset.orderId = order.id;
      content.dataset.selected = isSelected({ kind: "order", id: order.id })
        ? "true"
        : "false";
      content.classList.toggle(
        styles.mapMarkerSelected,
        isSelected({ kind: "order", id: order.id })
      );
      content.append(createOrderMarkerIcon());
      content.title = `${order.orderNo} · ${point.title} · ${order.feasibility}`;
      const marker = new amap.Marker({
        position: point.position,
        content,
        anchor: "bottom-center"
      });
      marker.on("click", () => {
        focusMapTarget({
          key: `order:${order.id}:${point.markerKind}`,
          position: point.position,
          zoom: ORDER_FOCUS_ZOOM
        });
        onSelectOrderRef.current(order.id);
      });
      marker.setMap(mapRef.current);
      markers.push({
        marker,
        content,
        key: `order:${order.id}:${point.markerKind}`,
        position: point.position,
        zoom: ORDER_FOCUS_ZOOM,
        selection: { kind: "order", id: order.id }
      });
    }

    markersRef.current = markers;
    if (!fittedRef.current && markers.length > 0) {
      mapRef.current.setFitView(markers.map(({ marker }) => marker));
      fittedRef.current = true;
    }
  }, [drivers, focusMapTarget, orders, status]);

  useEffect(() => {
    if (!selection || status !== "ready") return;
    const selectedMarker = markersRef.current.find(
      (record) =>
        record.selection.kind === selection.kind &&
        record.selection.id === selection.id
    );
    for (const record of markersRef.current) {
      const selected = record === selectedMarker;
      record.content.dataset.selected = selected ? "true" : "false";
      record.content.classList.toggle(styles.mapMarkerSelected, selected);
    }
    if (selectedMarker) focusMapTarget(selectedMarker);
  }, [focusMapTarget, selection, status]);

  return (
    <div className={styles.mapCanvas}>
      <div ref={containerRef} className={styles.mapContainer} aria-label="调度地图" />
      {status !== "ready" ? (
        <div className={styles.mapFallback} role="status">
          <span className={styles.mapFallbackIcon}>⌖</span>
          <strong>
            {status === "missing"
              ? "未配置高德浏览器 Key"
              : status === "error"
                ? "地图暂时不可用"
                : "正在载入实时地图"}
          </strong>
          <small>订单、司机和时间轴数据仍保持真实，不生成替代坐标。</small>
        </div>
      ) : null}
    </div>
  );
}

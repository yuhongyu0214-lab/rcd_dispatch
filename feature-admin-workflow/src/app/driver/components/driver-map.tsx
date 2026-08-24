"use client";

import { useEffect, useRef, useState } from "react";

export type DriverMapMarker = {
  id: string;
  kind: "driver" | "task" | "unassigned";
  label: string;
  lat: number;
  lng: number;
  stale?: boolean;
};

type AMapInstance = {
  destroy(): void;
  setFitView(): void;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
};

type AMapMarkerInstance = {
  on(event: "click", listener: () => void): void;
  off(event: "click", listener: () => void): void;
  setMap(map: AMapInstance | null): void;
  setPosition(position: [number, number]): void;
  setContent(content: HTMLElement): void;
  setzIndex(zIndex: number): void;
};

type AMapMarkerOptions = {
  position: [number, number];
  content: HTMLElement;
  anchor: "center";
  zIndex: number;
};

type AMapApi = {
  Map: new (
    container: HTMLDivElement,
    options: { center: [number, number]; zoom: number; resizeEnable: boolean }
  ) => AMapInstance;
  Marker: new (options: AMapMarkerOptions) => AMapMarkerInstance;
};

type ManagedDriverMapMarker = {
  instance: AMapMarkerInstance;
  clickListener: () => void;
  signature: string;
};

type DriverMapMarkerStore = Map<string, ManagedDriverMapMarker>;

export const DRIVER_MAP_MARKER_PALETTES = {
  activeDriver: {
    background: "var(--success)",
    foreground: "var(--ink)"
  },
  staleDriver: {
    background: "var(--muted)",
    foreground: "var(--surface)"
  },
  task: {
    background: "var(--nav)",
    foreground: "var(--on-nav)"
  },
  unassigned: {
    background: "var(--warning)",
    foreground: "var(--accent-ink)"
  }
} as const;

export const DRIVER_MAP_FALLBACK_CLASS =
  "flex h-48 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel)] px-6 text-center text-sm text-[var(--text-primary)]";

let amapPromise: Promise<AMapApi> | null = null;

function getAmapWindow() {
  return window as unknown as {
    AMap?: AMapApi;
    _AMapSecurityConfig?: { securityJsCode: string };
  };
}

function loadAmap(key: string, securityCode: string): Promise<AMapApi> {
  const amapWindow = getAmapWindow();
  if (amapWindow.AMap) return Promise.resolve(amapWindow.AMap);
  if (amapPromise) return amapPromise;

  amapWindow._AMapSecurityConfig = { securityJsCode: securityCode };
  amapPromise = new Promise<AMapApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => {
      const loadedAmap = getAmapWindow().AMap;
      if (loadedAmap) resolve(loadedAmap);
      else {
        amapPromise = null;
        reject(new Error("AMAP_GLOBAL_MISSING"));
      }
    };
    script.onerror = () => {
      amapPromise = null;
      reject(new Error("AMAP_LOAD_FAILED"));
    };
    document.head.appendChild(script);
  });
  return amapPromise;
}

function createMarkerContent(marker: DriverMapMarker, selected: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = marker.label;
  button.textContent =
    marker.kind === "driver" ? "车" : marker.kind === "task" ? "单" : "待";
  const palette =
    marker.kind === "driver"
      ? marker.stale
        ? DRIVER_MAP_MARKER_PALETTES.staleDriver
        : DRIVER_MAP_MARKER_PALETTES.activeDriver
      : marker.kind === "task"
        ? DRIVER_MAP_MARKER_PALETTES.task
        : DRIVER_MAP_MARKER_PALETTES.unassigned;
  button.style.cssText = [
    "width:var(--tap-target)",
    "height:var(--tap-target)",
    "border-radius:9999px",
    `border:${selected ? "4px solid var(--ink)" : "3px solid var(--surface)"}`,
    `background:${palette.background}`,
    `color:${palette.foreground}`,
    "font:700 13px system-ui",
    "box-shadow:var(--shadow-card)",
    "cursor:pointer"
  ].join(";");
  return button;
}

function markerSignature(marker: DriverMapMarker, selected: boolean) {
  return JSON.stringify([
    marker.kind,
    marker.label,
    marker.lat,
    marker.lng,
    marker.stale ?? false,
    selected
  ]);
}

export function createDriverMapMarkerStore(): DriverMapMarkerStore {
  return new Map();
}

export function syncDriverMapMarkers({
  map,
  markerStore,
  markers,
  selectedId,
  onSelect,
  createMarker,
  createContent = createMarkerContent,
  initializeView
}: {
  map: AMapInstance;
  markerStore: DriverMapMarkerStore;
  markers: DriverMapMarker[];
  selectedId: string | null;
  onSelect(id: string): void;
  createMarker(options: AMapMarkerOptions): AMapMarkerInstance;
  createContent?(marker: DriverMapMarker, selected: boolean): HTMLElement;
  initializeView: boolean;
}): boolean {
  const nextIds = new Set(markers.map((marker) => marker.id));

  for (const [id, managedMarker] of markerStore) {
    if (nextIds.has(id)) continue;
    managedMarker.instance.off("click", managedMarker.clickListener);
    managedMarker.instance.setMap(null);
    markerStore.delete(id);
  }

  for (const item of markers) {
    const selected = item.id === selectedId;
    const signature = markerSignature(item, selected);
    const existing = markerStore.get(item.id);

    if (existing) {
      if (existing.signature !== signature) {
        existing.instance.setPosition([item.lng, item.lat]);
        existing.instance.setContent(createContent(item, selected));
        existing.instance.setzIndex(selected ? 120 : 100);
        existing.signature = signature;
      }
      continue;
    }

    const clickListener = () => onSelect(item.id);
    const instance = createMarker({
      position: [item.lng, item.lat],
      content: createContent(item, selected),
      anchor: "center",
      zIndex: selected ? 120 : 100
    });
    instance.on("click", clickListener);
    instance.setMap(map);
    markerStore.set(item.id, { instance, clickListener, signature });
  }

  if (initializeView && markers.length > 0) {
    if (markers.length > 1) {
      map.setFitView();
    } else {
      map.setZoomAndCenter(13, [markers[0].lng, markers[0].lat]);
    }
    return true;
  }
  return false;
}

export function DriverMap({
  markers,
  selectedId,
  amapKey,
  amapSecurityCode,
  onSelect
}: {
  markers: DriverMapMarker[];
  selectedId: string | null;
  amapKey: string;
  amapSecurityCode: string;
  onSelect(id: string): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const amapRef = useRef<AMapApi | null>(null);
  const markerStoreRef = useRef(createDriverMapMarkerStore());
  const markersRef = useRef(markers);
  const onSelectRef = useRef(onSelect);
  const hasInitializedViewRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!amapKey || !amapSecurityCode || !containerRef.current) return;
    let disposed = false;
    let ownedMap: AMapInstance | null = null;
    const markerStore = markerStoreRef.current;

    void loadAmap(amapKey, amapSecurityCode)
      .then((AMap) => {
        if (disposed || !containerRef.current) return;
        const first = markersRef.current[0];
        ownedMap = new AMap.Map(containerRef.current, {
          center: first ? [first.lng, first.lat] : [121.4737, 31.2304],
          zoom: first ? 13 : 10,
          resizeEnable: true
        });
        mapRef.current = ownedMap;
        amapRef.current = AMap;
        setMapReadyVersion((version) => version + 1);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      for (const managedMarker of markerStore.values()) {
        managedMarker.instance.off("click", managedMarker.clickListener);
        managedMarker.instance.setMap(null);
      }
      markerStore.clear();
      ownedMap?.destroy();
      if (mapRef.current === ownedMap) {
        mapRef.current = null;
        amapRef.current = null;
        hasInitializedViewRef.current = false;
      }
    };
  }, [amapKey, amapSecurityCode]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap) return;

    const initializedView = syncDriverMapMarkers({
      map,
      markerStore: markerStoreRef.current,
      markers,
      selectedId,
      onSelect: (id) => onSelectRef.current(id),
      createMarker: (options) => new AMap.Marker(options),
      initializeView: !hasInitializedViewRef.current
    });
    if (initializedView) hasInitializedViewRef.current = true;
  }, [mapReadyVersion, markers, selectedId]);

  if (!amapKey || !amapSecurityCode || failed) {
    return (
      <div className={DRIVER_MAP_FALLBACK_CLASS}>
        地图暂不可用，任务列表仍可正常操作
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label="司机全局地图"
      className="h-48 w-full overflow-hidden rounded-2xl bg-[var(--map)]"
    />
  );
}

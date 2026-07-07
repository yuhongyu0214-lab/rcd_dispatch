"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MapBoardPayload, MapPoint, MapPointKind } from "@/lib/map/types";
import { DEFAULT_MAP_CENTER } from "@/lib/map/constants";

import styles from "./map-board.module.css";

type ApiPayload =
  | {
      success: true;
      data: MapBoardPayload;
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

type DispatchConfirmPayload =
  | {
      success: true;
      data: unknown;
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

type DispatchRecommendPayload =
  | {
      success: true;
      data: DispatchRecommendResult;
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

type AMapMap = {
  setFitView: (overlays?: AMapMarker[]) => void;
  setZoomAndCenter: (zoom: number, center: [number, number]) => void;
  setCenter: (center: [number, number]) => void;
  getCenter: () => [number, number];
  destroy: () => void;
};

type AMapMarker = {
  setMap: (map: AMapMap | null) => void;
  setPosition: (position: [number, number]) => void;
  setContent: (content: string) => void;
  on: (eventName: "click", handler: () => void) => void;
};

type AMapNamespace = {
  Map: new (
    container: HTMLDivElement,
    options: {
      center: [number, number];
      zoom: number;
      resizeEnable: boolean;
      viewMode: "2D";
      mapStyle: string;
    }
  ) => AMapMap;
  Marker: new (options: {
    position: [number, number];
    content: string;
    offset: AMapPixel;
    anchor: "center";
  }) => AMapMarker;
  Pixel: new (x: number, y: number) => AMapPixel;
};

type AMapPixel = object;

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
    rcdAmapLoader?: Promise<AMapNamespace>;
    rcdAmapLoaderKey?: string;
  }
}

const statusLabels: Record<string, string> = {
  ACTIVE: "营业中",
  INACTIVE: "停用",
  PENDING: "待派单",
  RECOMMENDING: "推荐中",
  ASSIGNED: "已派单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  RECYCLED: "已回收",
  CANCELLED: "已取消",
  OFFLINE: "离线",
  S1: "门店空闲",
  S2: "返程空闲",
  S3: "门店忙碌",
  S4: "订单忙碌",
  UNAVAILABLE: "不可用",
  AVAILABLE: "可用",
  PRE_ASSIGNED: "预占",
  IN_USE: "使用中"
};

type BoardKind = MapPointKind | "ALERT";

type MapAlertPoint = {
  kind: "ALERT";
  id: string;
  title: string;
  status: "WARN" | "DANGER";
  storeName: string;
  target: string;
  thresholdMinutes: number;
  exceededMinutes: number;
  description: string;
  coordinate: MapPoint["coordinate"];
};

type BoardPoint = MapPoint | MapAlertPoint;

const kindLabels: Record<BoardKind, string> = {
  ORDER: "订单",
  DRIVER: "司机",
  VEHICLE: "车辆",
  STORE: "门店",
  ALERT: "预警"
};

const pointShortName: Record<BoardKind, string> = {
  ORDER: "单",
  DRIVER: "人",
  VEHICLE: "车",
  STORE: "店",
  ALERT: "警"
};

const pointColors: Record<BoardKind, string> = {
  ORDER: "var(--warning)",
  DRIVER: "var(--success)",
  VEHICLE: "var(--info)",
  STORE: "var(--primary)",
  ALERT: "var(--danger)"
};

const DRIVER_SIGNAL_ONLINE_MS = 180_000;
const DRIVER_SIGNAL_WEAK_MS = 3_600_000;

function getDriverSignalLevel(point: BoardPoint): "online" | "weak" | "offline" {
  if (point.kind !== "DRIVER") return "online";
  if (!point.lastSeenAt) return "offline";
  const age = Date.now() - new Date(point.lastSeenAt).getTime();
  if (age <= DRIVER_SIGNAL_ONLINE_MS) return "online";
  if (age <= DRIVER_SIGNAL_WEAK_MS) return "weak";
  return "offline";
}

const SIGNAL_COLORS: Record<string, string> = {
  online: "var(--success)",
  weak: "oklch(0.700 0.120 80)",
  offline: "oklch(0.600 0.010 235)"
};

function getPointColor(point: BoardPoint): string {
  if (point.kind === "DRIVER") return SIGNAL_COLORS[getDriverSignalLevel(point)];
  if (point.kind === "ORDER") {
    return isPickupOrder(point.type) ? "var(--info)" : "var(--success)";
  }
  return pointColors[point.kind];
}

const markerSvgByKind: Record<BoardKind, string> = {
  ORDER:
    '<path d="M17 3C10.9 3 6 7.9 6 14c0 7.6 11 17 11 17s11-9.4 11-17C28 7.9 23.1 3 17 3Z" fill="currentColor" stroke="#fff" stroke-width="2.4"/><circle cx="17" cy="14" r="4.2" fill="#fff" opacity=".92"/>',
  DRIVER:
    '<circle cx="17" cy="17" r="12.5" fill="currentColor" stroke="#fff" stroke-width="2.4"/><circle cx="17" cy="17" r="6.2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M17 17v7M11.2 18.8l-4.4 3.5M22.8 18.8l4.4 3.5" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2.2"/>',
  VEHICLE:
    '<path d="M8 15.2h2.1l2.4-5.2h9l2.4 5.2H26a3 3 0 0 1 3 3v5.2H5v-5.2a3 3 0 0 1 3-3Z" fill="currentColor" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="11" cy="24" r="2.6" fill="#fff"/><circle cx="23" cy="24" r="2.6" fill="#fff"/><path d="M12.2 15.1h9.6" stroke="#fff" stroke-linecap="round" stroke-width="2"/>',
  STORE:
    '<path d="M5.5 15.8 17 6l11.5 9.8" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/><path d="M8.5 15.2h17v14h-17z" fill="currentColor" stroke="#fff" stroke-linejoin="round" stroke-width="2.4"/><path d="M14.2 29.2v-7h5.6v7" fill="none" stroke="#fff" stroke-linejoin="round" stroke-width="2.1"/>',
  ALERT:
    '<path d="M17 4.2 31 29.2H3L17 4.2Z" fill="currentColor" stroke="#fff" stroke-linejoin="round" stroke-width="2.4"/><path d="M17 12.8v8.5" stroke="#fff" stroke-linecap="round" stroke-width="2.4"/><circle cx="17" cy="25" r="1.7" fill="#fff"/>'
};

const orderTypeLabels: Record<string, string> = {
  STORE_PICKUP: "门店取车",
  STORE_RETURN: "门店还车",
  DOOR_DELIVERY: "送车上门",
  DOOR_PICKUP: "上门取车"
};

type TimeFilter = "ALL" | "2" | "4" | "6";
type OrderDirectionFilter = "ALL" | "PICKUP" | "RETURN";
type DispatchOutcome = "DISPATCHED" | "PENDING / NO_DRIVER" | "MANUAL / ETA_EXCEEDED";

type DispatchRecommendResult = {
  orderId: string;
  orderNo: string;
  outcome: "DISPATCHED" | "PENDING" | "MANUAL";
  reason: "NO_DRIVER" | "ETA_EXCEEDED" | null;
  topN: Array<{
    driverId: string;
    driverName: string;
    driverStatus: string;
    storeName: string;
    etaMinutes: number;
    loadPenaltyMinutes: number;
    priorityRank: number;
  }>;
};

type RecommendCandidate = {
  id: string;
  title: string;
  priority: number;
  etaMinutes: number;
  loadPenalty: number;
  statusText: string;
  targetText: string;
  outcome: string;
  point: BoardPoint;
};

type DispatchStatus = {
  kind: "info" | "success" | "error";
  message: string;
};

type MapBoardProps = {
  amapKey: string;
  amapSecurityCode?: string;
};

function loadAmap(amapKey: string, amapSecurityCode?: string) {
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }

  const loaderKey = `${amapKey}:${amapSecurityCode ?? ""}`;

  if (window.rcdAmapLoaderKey !== loaderKey) {
    window.rcdAmapLoader = undefined;
    window.rcdAmapLoaderKey = loaderKey;
  }

  if (amapSecurityCode) {
    window._AMapSecurityConfig = {
      securityJsCode: amapSecurityCode
    };
  }

  if (!window.rcdAmapLoader) {
    window.rcdAmapLoader = new Promise<AMapNamespace>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(
        amapKey
      )}`;
      script.async = true;
      script.onload = () => {
        if (window.AMap) {
          resolve(window.AMap);
          return;
        }

        reject(new Error("高德地图脚本已加载，但 AMap 对象不可用"));
      };
      script.onerror = () => reject(new Error("高德地图脚本加载失败"));
      document.head.appendChild(script);
    });
  }

  return window.rcdAmapLoader;
}

function getPointTitle(point: BoardPoint) {
  if (point.kind === "ORDER") {
    return point.display?.orderNo ?? point.orderNo;
  }

  if (point.kind === "ALERT") {
    return point.title;
  }

  if (point.kind === "DRIVER") {
    return point.name;
  }

  if (point.kind === "STORE") {
    return point.name;
  }

  return point.licensePlate;
}

function getPointSubtitle(point: BoardPoint) {
  if (point.kind === "ORDER") {
    const display = point.display;

    if (display) {
      return `${display.pickupName} -> ${display.returnName}`;
    }

    return point.pickupAddress;
  }

  if (point.kind === "ALERT") {
    return point.description;
  }

  if (point.kind === "DRIVER") {
    return point.phone;
  }

  if (point.kind === "STORE") {
    return point.code;
  }

  return point.vehicleType;
}

function getPointStatus(point: BoardPoint) {
  if (point.kind === "ALERT") {
    return point.status === "DANGER" ? "超阈值" : "待处置";
  }

  if (point.kind === "ORDER") {
    return point.display?.displayStatus ?? statusLabels[point.status] ?? point.status;
  }

  if (point.kind === "DRIVER") {
    const signal = getDriverSignalLevel(point);
    if (signal === "offline") return "离线";
    if (signal === "weak") return "信号弱";
  }

  return statusLabels[point.status] ?? point.status;
}

function getOrderTypeText(point: BoardPoint) {
  if (point.kind !== "ORDER") {
    return "";
  }

  return point.display?.typeText ?? orderTypeLabels[point.type] ?? point.type;
}

function getOrderTimeRange(point: BoardPoint) {
  if (point.kind !== "ORDER") {
    return "";
  }

  const display = point.display;
  const formatClock = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));

  if (display?.scheduledStartAt || display?.scheduledEndAt) {
    return [display.scheduledStartAt, display.scheduledEndAt]
      .filter(Boolean)
      .map(formatClock)
      .join("-");
  }

  return formatClock(point.scheduledAt);
}

function getOrderPlate(point: BoardPoint) {
  if (point.kind !== "ORDER") {
    return "";
  }

  return point.display?.plate ?? point.vehicleLabel ?? "待关联";
}

function getOrderProgress(point: BoardPoint) {
  if (point.kind !== "ORDER") {
    return "";
  }

  return point.display?.progressText ?? "待整备";
}

function getOrderLockText(point: BoardPoint) {
  if (point.kind !== "ORDER") {
    return "";
  }

  return point.display?.locked ? "是" : "否";
}

function getOrderDriverName(point: BoardPoint, fallbackName?: string) {
  if (point.kind !== "ORDER") {
    return fallbackName ?? "待推荐";
  }

  return point.display?.driverName ?? fallbackName ?? "待推荐";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getMarkerContent(
  point: BoardPoint,
  activeKind: BoardKind,
  selectedPoint: BoardPoint | null,
  focusedPointIds: Set<string>
) {
  const kindClass = point.kind.toLowerCase();
  const label = escapeHtml(getPointTitle(point));
  const isSelected = selectedPoint?.id === point.id;
  const isFocused = point.kind === activeKind && focusedPointIds.has(point.id);
  const scale = isSelected ? 1.18 : isFocused ? 1.08 : 1;
  const opacity = isSelected || isFocused ? 1 : 0.38;
  const filter = isSelected || isFocused ? "none" : "saturate(0.72)";
  const zIndex = isSelected ? 3 : 1;
  const markerColor = getPointColor(point);
  const style = [
    "display:block",
    "width:34px",
    "height:34px",
    "border:0",
    "background:transparent",
    `color:${markerColor}`,
    "cursor:pointer",
    "filter:drop-shadow(0 14px 18px rgb(17 17 17 / 22%))",
    "transition:opacity 160ms ease, transform 160ms ease, filter 160ms ease",
    `opacity:${opacity}`,
    `transform:scale(${scale})`,
    `filter:${filter === "none" ? "drop-shadow(0 14px 18px rgb(17 17 17 / 22%))" : `${filter} drop-shadow(0 14px 18px rgb(17 17 17 / 16%))`}`,
    `z-index:${zIndex}`
  ].join(";");

  return `<button class="rcd-amap-marker rcd-amap-marker-${kindClass}" style="${style}" type="button" aria-label="${label}"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34" role="img">${markerSvgByKind[point.kind]}</svg></button>`;
}

function getAllPoints(payload: MapBoardPayload | null): MapPoint[] {
  if (!payload) {
    return [];
  }

  return [...payload.orders, ...payload.drivers, ...payload.vehicles, ...payload.stores];
}

function getAlertPoints(payload: MapBoardPayload | null): MapAlertPoint[] {
  if (!payload) {
    return [];
  }

  const orderAlerts = payload.orders
    .filter((point) => point.status === "PENDING" || point.status === "RECOMMENDING")
    .slice(0, 3)
    .map((point, index) => {
      const orderNo = point.display?.orderNo ?? point.orderNo;
      const pickupName = point.display?.pickupName ?? point.pickupAddress;

      return {
        kind: "ALERT" as const,
        id: `alert-order-${point.id}`,
        title: `未派单超时 · ${orderNo}`,
        status: index === 0 ? ("DANGER" as const) : ("WARN" as const),
        storeName: point.storeName,
        target: orderNo,
        thresholdMinutes: 15,
        exceededMinutes: 48 - index * 11,
        description: `${pickupName} 待派单超过阈值`,
        coordinate: point.coordinate
      };
    });

  const vehicleAlerts = payload.vehicles
    .filter((point) => point.status === "UNAVAILABLE")
    .slice(0, 2)
    .map((point, index) => ({
      kind: "ALERT" as const,
      id: `alert-vehicle-${point.id}`,
      title: `GPS 离线 · ${point.licensePlate}`,
      status: "DANGER" as const,
      storeName: point.storeName,
      target: point.licensePlate,
      thresholdMinutes: 30,
      exceededMinutes: 74 - index * 9,
      description: `${point.licensePlate} GPS 状态需复核`,
      coordinate: point.coordinate
    }));

  return [...orderAlerts, ...vehicleAlerts].sort(
    (left, right) => right.exceededMinutes - left.exceededMinutes
  );
}

function getKindStats(
  payload: MapBoardPayload | null,
  activeKind: BoardKind,
  visiblePoints: BoardPoint[]
) {
  if (!payload) {
    return [
      ["当前点位", 0],
      ["当前总数", 0],
      ["最近刷新", "--"]
    ] as const;
  }

  const allCount =
    payload.orders.length +
    payload.drivers.length +
    payload.vehicles.length +
    payload.stores.length +
    getAlertPoints(payload).length;
  const refreshedAt = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(payload.generatedAt));

  if (activeKind === "ORDER") {
    return [
      ["订单点位", visiblePoints.length],
      [
        "待取还车",
        visiblePoints.filter(
          (point) =>
            point.kind === "ORDER" &&
            (point.status === "PENDING" || point.status === "ASSIGNED")
        )
          .length
      ],
      ["最近刷新", refreshedAt]
    ] as const;
  }

  if (activeKind === "DRIVER") {
    const onlineCount = visiblePoints.filter(
      (p) => p.kind === "DRIVER" && getDriverSignalLevel(p) === "online"
    ).length;
    const weakCount = visiblePoints.filter(
      (p) => p.kind === "DRIVER" && getDriverSignalLevel(p) === "weak"
    ).length;
    const offlineCount = visiblePoints.filter(
      (p) => p.kind === "DRIVER" && getDriverSignalLevel(p) === "offline"
    ).length;
    return [
      ["司机点位", visiblePoints.length],
      ["在线", onlineCount],
      ["信号弱", weakCount],
      ["离线", offlineCount],
      ["最近刷新", refreshedAt]
    ] as const;
  }

  if (activeKind === "VEHICLE") {
    return [
      ["车辆点位", visiblePoints.length],
      ["在线车辆", visiblePoints.filter((point) => point.status !== "UNAVAILABLE").length],
      ["最近刷新", refreshedAt]
    ] as const;
  }

  if (activeKind === "ALERT") {
    return [
      ["预警点位", visiblePoints.length],
      [
        "超阈值",
        visiblePoints.filter((point) => point.kind === "ALERT" && point.status === "DANGER")
          .length
      ],
      ["最近刷新", refreshedAt]
    ] as const;
  }

  return [
    ["门店点位", visiblePoints.length],
    ["地图总点位", allCount],
    ["最近刷新", refreshedAt]
  ] as const;
}

function isPickupOrder(type: string) {
  return type === "STORE_PICKUP" || type === "DOOR_DELIVERY";
}

function isReturnOrder(type: string) {
  return type === "STORE_RETURN" || type === "DOOR_PICKUP";
}

function pointMatchesKeyword(point: BoardPoint, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return true;
  }

  const values = [
    getPointTitle(point),
    getPointSubtitle(point),
    getPointStatus(point),
    point.storeName,
    point.coordinate.source
  ];

  if (point.kind === "ORDER") {
    const display = point.display;

    values.push(
      getOrderTypeText(point),
      point.returnAddress,
      point.vehicleLabel ?? "",
      display?.shortOrderNo ?? "",
      display?.plate ?? "",
      display?.driverName ?? "",
      display?.source ?? "",
      display?.traceId ?? "",
      display?.progressText ?? "",
      display?.scheduledStartAt ?? "",
      display?.scheduledEndAt ?? ""
    );
  }

  if (point.kind === "VEHICLE") {
    values.push(point.licensePlate, point.vehicleType);
  }

  if (point.kind === "STORE") {
    values.push(point.code, point.name);
  }

  if (point.kind === "ALERT") {
    values.push(point.title, point.target, point.description);
  }

  return values.some((value) => value.toLowerCase().includes(normalizedKeyword));
}

function pointMatchesOrderDirection(point: BoardPoint, filter: OrderDirectionFilter) {
  if (filter === "ALL" || point.kind !== "ORDER") {
    return true;
  }

  if (filter === "PICKUP") {
    return isPickupOrder(point.type);
  }

  return isReturnOrder(point.type);
}

function pointMatchesTimeWindow(
  point: BoardPoint,
  filter: TimeFilter,
  generatedAt: string | null
) {
  if (filter === "ALL" || point.kind !== "ORDER" || !generatedAt) {
    return true;
  }

  const baseTime = new Date(generatedAt).getTime();
  const scheduledTime = new Date(point.display?.scheduledAt ?? point.scheduledAt).getTime();
  const windowMs = Number(filter) * 60 * 60 * 1000;

  return scheduledTime >= baseTime && scheduledTime <= baseTime + windowMs;
}

function filterPoints(
  points: BoardPoint[],
  keyword: string,
  timeFilter: TimeFilter,
  orderDirectionFilter: OrderDirectionFilter,
  generatedAt: string | null
) {
  return points.filter(
    (point) =>
      pointMatchesKeyword(point, keyword) &&
      pointMatchesTimeWindow(point, timeFilter, generatedAt) &&
      pointMatchesOrderDirection(point, orderDirectionFilter)
  );
}

function getPointPositionPercent(point: BoardPoint, points: BoardPoint[]) {
  // 排除 FALLBACK（无坐标）点位，避免 lat:0/lng:0 拉偏地图视口
  const realPoints = points.filter((p) => p.coordinate.source !== "FALLBACK");
  const lats = realPoints.map((item) => item.coordinate.lat);
  const lngs = realPoints.map((item) => item.coordinate.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.004);
  const lngRange = Math.max(maxLng - minLng, 0.004);

  return {
    left: ((point.coordinate.lng - minLng) / lngRange) * 78 + 11,
    top: (1 - (point.coordinate.lat - minLat) / latRange) * 72 + 12
  };
}

function getPointPosition(point: BoardPoint, points: BoardPoint[]) {
  const position = getPointPositionPercent(point, points);

  return {
    left: `${position.left}%`,
    top: `${position.top}%`
  };
}

function getRoutePreviewStyle(from: BoardPoint, to: BoardPoint, points: BoardPoint[]) {
  const start = getPointPositionPercent(from, points);
  const end = getPointPositionPercent(to, points);
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return {
    left: `${start.left}%`,
    top: `${start.top}%`,
    width: `${length}%`,
    transform: `rotate(${angle}deg)`
  };
}

function getDriverLoadPenalty(status: string) {
  const loadPenaltyByStatus: Record<string, number> = {
    S1: 0,
    S2: 4,
    S3: 12,
    S4: 20
  };

  return loadPenaltyByStatus[status] ?? 30;
}

export function MapBoard({ amapKey, amapSecurityCode }: MapBoardProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markersRef = useRef<AMapMarker[]>([]);
  const markersByIdRef = useRef<Map<string, AMapMarker>>(new Map());
  const hasFittedMapRef = useRef(false);
  const fetchEpochRef = useRef(0);
  const scaleBaseDprRef = useRef(1);
  const [payload, setPayload] = useState<MapBoardPayload | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<BoardPoint | null>(null);
  const [activeKind, setActiveKind] = useState<BoardKind>("ORDER");
  const [keyword, setKeyword] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("ALL");
  const [orderDirectionFilter, setOrderDirectionFilter] =
    useState<OrderDirectionFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amapReady, setAmapReady] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<DispatchStatus | null>(null);
  const [dispatchRecommendation, setDispatchRecommendation] =
    useState<DispatchRecommendResult | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [realEtaData, setRealEtaData] = useState<{
    etaMinutes: number;
    distanceMeters: number;
  } | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState(
    amapKey
      ? "正在加载高德地图"
      : "未配置高德 JS Key，已启用本地降级视图"
  );

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const tokenNames = [
      "--design-w",
      "--design-h",
      "--app-scale",
      "--panel-head-h",
      "--list-content-w",
      "--list-scrollbar-w",
      "--card-action-h",
      "--map-dock-h",
      "--detail-card-h",
      "--recommend-card-h",
      "--bg-deep",
      "--bg-elevated",
      "--line",
      "--muted-line",
      "--surface-glass",
      "--shadow-card",
      "--shadow-modal",
      "--primary-glow",
      "--road",
      "--font-system",
      "--font-mono",
      "--glow-idle",
      "--glow-busy",
      "--glow-warn",
      "--glow-exec"
    ];
    const previousValues = new Map(
      tokenNames.map((tokenName) => [tokenName, rootStyle.getPropertyValue(tokenName)])
    );
    scaleBaseDprRef.current = window.devicePixelRatio || 1;

    function updateViewportScale() {
      const baseDpr = scaleBaseDprRef.current || 1;
      const currentDpr = window.devicePixelRatio || baseDpr;
      const browserZoomFactor = currentDpr / baseDpr;
      const frameW = window.innerWidth * browserZoomFactor;
      const frameH = window.innerHeight * browserZoomFactor;
      const railW = 72;
      const workPanelW = 420;
      const minRightW = 900;
      const designH = 1000;
      const designW = Math.max(
        Math.round(designH * (frameW / frameH)),
        railW + workPanelW + minRightW
      );
      const appScale = Math.min(frameW / designW, frameH / designH);

      rootStyle.setProperty("--design-w", `${designW}px`);
      rootStyle.setProperty("--design-h", `${designH}px`);
      rootStyle.setProperty("--app-scale", appScale.toFixed(5));
      rootStyle.setProperty("--panel-head-h", "396px");
      rootStyle.setProperty("--list-content-w", "408px");
      rootStyle.setProperty("--list-scrollbar-w", "12px");
      rootStyle.setProperty("--card-action-h", "32px");
      rootStyle.setProperty("--map-dock-h", "236px");
      rootStyle.setProperty("--detail-card-h", "208px");
      rootStyle.setProperty("--recommend-card-h", "208px");
      rootStyle.setProperty("--bg-deep", "oklch(0.235 0.032 240)");
      rootStyle.setProperty("--bg-elevated", "oklch(0.330 0.045 240)");
      rootStyle.setProperty("--line", "oklch(0.810 0.010 235)");
      rootStyle.setProperty("--muted-line", "oklch(0.790 0.012 235)");
      rootStyle.setProperty(
        "--surface-glass",
        "color-mix(in srgb, var(--surface) 86%, transparent)"
      );
      rootStyle.setProperty("--shadow-card", "0 6px 8px rgba(31, 35, 39, 0.08)");
      rootStyle.setProperty("--shadow-modal", "0 18px 46px rgba(31, 35, 39, 0.18)");
      rootStyle.setProperty(
        "--primary-glow",
        "color-mix(in srgb, oklch(0.635 0.115 35) 26%, transparent)"
      );
      rootStyle.setProperty("--road", "color-mix(in srgb, var(--ink) 11%, transparent)");
      rootStyle.setProperty(
        "--font-system",
        '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif'
      );
      rootStyle.setProperty("--font-mono", '"SF Mono", "Space Mono", Consolas, monospace');
      rootStyle.setProperty(
        "--glow-idle",
        "0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent)"
      );
      rootStyle.setProperty(
        "--glow-busy",
        "0 0 0 4px color-mix(in srgb, var(--warning) 18%, transparent)"
      );
      rootStyle.setProperty(
        "--glow-warn",
        "0 0 0 4px color-mix(in srgb, var(--danger) 18%, transparent)"
      );
      rootStyle.setProperty(
        "--glow-exec",
        "0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent)"
      );
    }

    updateViewportScale();
    window.addEventListener("resize", updateViewportScale);

    return () => {
      window.removeEventListener("resize", updateViewportScale);
      previousValues.forEach((value, tokenName) => {
        if (value) {
          rootStyle.setProperty(tokenName, value);
          return;
        }

        rootStyle.removeProperty(tokenName);
      });
    };
  }, []);

  const allPoints = useMemo<BoardPoint[]>(
    () => [...getAllPoints(payload), ...getAlertPoints(payload)],
    [payload]
  );
  const activePoints = useMemo(
    () => allPoints.filter((point) => point.kind === activeKind),
    [activeKind, allPoints]
  );
  const filteredActivePoints = useMemo(
    () =>
      filterPoints(
        activePoints,
        keyword,
        timeFilter,
        orderDirectionFilter,
        payload?.generatedAt ?? null
      ),
    [activePoints, keyword, orderDirectionFilter, payload?.generatedAt, timeFilter]
  );
  const focusedPointIds = useMemo(
    () => new Set(filteredActivePoints.map((point) => point.id)),
    [filteredActivePoints]
  );
  const kindStats = useMemo(
    () => getKindStats(payload, activeKind, filteredActivePoints),
    [activeKind, filteredActivePoints, payload]
  );
  const driverCandidates = useMemo(
    () =>
      (payload?.drivers ?? [])
        .filter((point) => point.status !== "OFFLINE" && point.status !== "UNAVAILABLE")
        .slice(0, 3)
        .map((point, index) => {
          const loadPenalty = getDriverLoadPenalty(point.status);
          const etaMinutes = -1;
          const outcome: DispatchOutcome = "PENDING / NO_DRIVER";

          return {
            driver: point,
            etaMinutes,
            loadPenalty,
            outcome,
            priority: index + 1
          };
        }),
    [payload?.drivers]
  );
  const etaPlans = useMemo(() => {
    if (realEtaData) {
      return [
        {
          rank: "主" as const,
          title: "高德实时路径规划",
          description: `驾车 ${realEtaData.etaMinutes} 分钟 · ${(realEtaData.distanceMeters / 1000).toFixed(1)} 公里`,
          timeText: `${realEtaData.etaMinutes}m`,
        },
      ];
    }
    if (etaLoading) {
      return [
        {
          rank: "主" as const,
          title: "正在计算路径...",
          description: "调用高德驾车路径规划 API",
          timeText: "...",
        },
      ];
    }
    if (etaError) {
      return [
        {
          rank: "主" as const,
          title: "无法计算 ETA",
          description: etaError,
          timeText: "--",
        },
      ];
    }
    // 未选中订单+司机时不展示任何 ETA 数据
    return [];
  }, [realEtaData, etaLoading, etaError]);
  const recommendCandidates = useMemo<RecommendCandidate[]>(() => {
    const isDriverView = activeKind === "DRIVER" || selectedPoint?.kind === "DRIVER";

    if (isDriverView) {
      const targetDriverName =
        selectedPoint?.kind === "DRIVER" ? selectedPoint.name : "当前司机";

      return (payload?.orders ?? []).slice(0, 3).map((point, index) => {
        const loadPenalty = index === 0 ? 0 : index * 7;
        const etaMinutes = -1;

        return {
          id: point.id,
          title: point.display?.orderNo ?? point.orderNo,
          priority: index + 1,
          etaMinutes,
          loadPenalty,
          statusText: getPointStatus(point),
          targetText: targetDriverName,
          outcome: "ETA 未计算",
          point
        };
      });
    }

    const apiCandidates =
      dispatchRecommendation?.topN.reduce<RecommendCandidate[]>((items, candidate) => {
          const driverPoint = payload?.drivers.find(
            (point) => point.id === candidate.driverId
          );

          if (!driverPoint) {
            return items;
          }

          const outcome =
            dispatchRecommendation.outcome === "MANUAL"
              ? "MANUAL / ETA_EXCEEDED"
              : dispatchRecommendation.outcome === "PENDING"
                ? "PENDING / NO_DRIVER"
                : "DISPATCHED";

          items.push({
            id: candidate.driverId,
            title: candidate.driverName,
            priority: candidate.priorityRank,
            etaMinutes: candidate.etaMinutes,
            loadPenalty: candidate.loadPenaltyMinutes,
            statusText: getPointStatus(driverPoint),
            targetText: selectedPoint ? getPointTitle(selectedPoint) : "当前订单",
            outcome,
            point: driverPoint
          });

          return items;
        }, []) ?? [];

    if (apiCandidates.length > 0) {
      return apiCandidates;
    }

    return driverCandidates.map((candidate) => ({
      id: candidate.driver.id,
      title: candidate.driver.name,
      priority: candidate.priority,
      etaMinutes: candidate.etaMinutes,
      loadPenalty: candidate.loadPenalty,
      statusText: getPointStatus(candidate.driver),
      targetText: selectedPoint ? getPointTitle(selectedPoint) : "当前订单",
      outcome: candidate.outcome,
      point: candidate.driver
    }));
  }, [
    activeKind,
    dispatchRecommendation,
    driverCandidates,
    payload?.drivers,
    payload?.orders,
    selectedPoint
  ]);
  const selectedCandidate = useMemo(
    () => recommendCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? null,
    [recommendCandidates, selectedCandidateId]
  );

  // ── 真实 ETA 请求（选中订单 + 候选司机时调用高德驾车路径规划）──
  useEffect(() => {
    if (
      !selectedPoint ||
      selectedPoint.kind !== "ORDER" ||
      !selectedCandidate
    ) {
      setRealEtaData(null);
      setEtaError(null);
      return;
    }

    let disposed = false;
    setEtaLoading(true);
    setEtaError(null);

    fetch(
      `/api/map/eta?orderId=${encodeURIComponent(selectedPoint.id)}&driverId=${encodeURIComponent(selectedCandidate.id)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((result: {
        success: boolean;
        data?: { etaMinutes: number; distanceMeters: number; etaStatus?: string; failReason?: string };
      }) => {
        if (disposed) return;
        const data = result.data;
        if (result.success && data && data.etaStatus !== "FAILED") {
          setRealEtaData({
            etaMinutes: data.etaMinutes,
            distanceMeters: data.distanceMeters,
          });
          setEtaError(null);
        } else {
          setRealEtaData(null);
          setEtaError(data?.failReason ?? "高德 API 返回异常");
        }
      })
      .catch(() => {
        if (!disposed) {
          setRealEtaData(null);
          setEtaError("网络请求失败，请检查服务状态");
        }
      })
      .finally(() => {
        if (!disposed) setEtaLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [selectedPoint, selectedCandidate]);

  const dispatchOrderPoint = selectedPoint?.kind === "ORDER" ? selectedPoint : null;
  const dispatchDriverPoint =
    dispatchOrderPoint && selectedCandidate?.point.kind === "DRIVER"
      ? selectedCandidate.point
      : null;
  const dispatchAction =
    dispatchOrderPoint?.status === "ASSIGNED" || dispatchOrderPoint?.status === "ACCEPTED"
      ? "REASSIGN"
      : "ASSIGN";
  const dispatchStatusClass =
    dispatchStatus?.kind === "success"
      ? styles.dispatchStatusSuccess
      : dispatchStatus?.kind === "error"
        ? styles.dispatchStatusError
        : styles.dispatchStatusInfo;
  const routePreviewTarget = useMemo(() => {
    if (selectedPoint?.kind !== "ORDER" || !payload?.drivers.length) {
      return null;
    }

    // 无坐标（FALLBACK）的订单不计算司机距离
    if (selectedPoint.coordinate.source === "FALLBACK") return null;

    return payload.drivers
      .filter((point) => point.status !== "OFFLINE" && point.status !== "UNAVAILABLE")
      .filter((point) => point.coordinate.source !== "FALLBACK")
      .map((point) => ({
        point,
        distance: Math.hypot(
          selectedPoint.coordinate.lat - point.coordinate.lat,
          selectedPoint.coordinate.lng - point.coordinate.lng
        )
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.point ?? null;
  }, [payload?.drivers, selectedPoint]);

  const fetchBoard = useCallback(async () => {
    fetchEpochRef.current += 1;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/map", {
        cache: "no-store"
      });
      const result = (await response.json()) as ApiPayload;

      if (!result.success) {
        setError(`${result.error}（traceId: ${result.traceId}）`);
        return;
      }

      const nextPoints = [...getAllPoints(result.data), ...getAlertPoints(result.data)];
      setPayload(result.data);
      setSelectedPoint((current) => {
        if (!current) {
          return nextPoints[0] ?? null;
        }

        return (
          nextPoints.find((point) => point.id === current.id && point.kind === current.kind) ??
          nextPoints[0] ??
          null
        );
      });
    } catch {
      setError("地图看板数据请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  useEffect(() => {
    const id = setInterval(async () => {
      const preEpoch = fetchEpochRef.current;
      try {
        const res = await fetch("/api/map?objectType=drivers", {
          cache: "no-store"
        });
        const result = (await res.json()) as ApiPayload;
        if (fetchEpochRef.current !== preEpoch) return;
        if (!result.success) return;
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                drivers: result.data.drivers,
                summary: result.data.summary,
                generatedAt: result.data.generatedAt
              }
            : result.data
        );
      } catch {
        /* silent background polling */
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (selectedPoint?.kind !== "ORDER") {
      setDispatchRecommendation(null);
      setRecommendationError(null);
      setRecommendationLoading(false);
      return;
    }

    let disposed = false;

    async function fetchRecommendation(orderId: string) {
      setRecommendationLoading(true);
      setRecommendationError(null);

      try {
        const response = await fetch("/api/dispatch/recommend", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orderId,
            topN: 3
          })
        });
        const result = (await response.json()) as DispatchRecommendPayload;

        if (disposed) {
          return;
        }

        if (!result.success) {
          setDispatchRecommendation(null);
          setRecommendationError(`${result.error}（traceId: ${result.traceId}）`);
          return;
        }

        setDispatchRecommendation(result.data);
      } catch {
        if (!disposed) {
          setDispatchRecommendation(null);
          setRecommendationError("推荐派单接口暂不可用，已使用本地降级候选");
        }
      } finally {
        if (!disposed) {
          setRecommendationLoading(false);
        }
      }
    }

    void fetchRecommendation(selectedPoint.id);

    return () => {
      disposed = true;
    };
  }, [selectedPoint?.id, selectedPoint?.kind]);

  useEffect(() => {
    setSelectedCandidateId(null);
    setDispatchStatus(null);
  }, [activeKind, selectedPoint?.id]);

  const confirmDispatch = useCallback(async () => {
    if (!dispatchOrderPoint) {
      setDispatchStatus({
        kind: "error",
        message: "请先在地图看板选中一个订单"
      });
      return;
    }

    if (!dispatchDriverPoint) {
      setDispatchStatus({
        kind: "error",
        message: "请先在推荐派单 Top N 中选中司机"
      });
      return;
    }

    if (
      dispatchOrderPoint.status !== "PENDING" &&
      dispatchOrderPoint.status !== "RECOMMENDING" &&
      dispatchOrderPoint.status !== "ASSIGNED" &&
      dispatchOrderPoint.status !== "ACCEPTED"
    ) {
      setDispatchStatus({
        kind: "error",
        message: `${getPointStatus(dispatchOrderPoint)}订单暂不支持派单或改派`
      });
      return;
    }

    if (
      dispatchAction === "REASSIGN" &&
      dispatchOrderPoint.display?.driverId === dispatchDriverPoint.id
    ) {
      setDispatchStatus({
        kind: "error",
        message: "该司机已是当前司机，请选择其他候选司机"
      });
      return;
    }

    setDispatching(true);
    setDispatchStatus({
      kind: "info",
      message:
        dispatchAction === "REASSIGN"
          ? `正在改派给 ${dispatchDriverPoint.name}`
          : `正在派给 ${dispatchDriverPoint.name}`
    });

    try {
      const response = await fetch(
        dispatchAction === "REASSIGN"
          ? "/api/assignments/reassign"
          : "/api/dispatch/confirm",
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orderId: dispatchOrderPoint.id,
          driverId: dispatchDriverPoint.id,
          ...(dispatchAction === "REASSIGN"
            ? { reason: "地图看板推荐派单调整" }
            : {})
        })
        }
      );
      const result = (await response.json()) as DispatchConfirmPayload;

      if (!result.success) {
        setDispatchStatus({
          kind: "error",
          message: `${result.error}（traceId: ${result.traceId}）`
        });
        return;
      }

      setDispatchStatus({
        kind: "success",
        message:
          dispatchAction === "REASSIGN"
            ? `已改派给 ${dispatchDriverPoint.name}，地图看板已刷新`
            : `已派给 ${dispatchDriverPoint.name}，地图看板已刷新`
      });
      setSelectedCandidateId(null);
      await fetchBoard();
    } catch {
      setDispatchStatus({
        kind: "error",
        message: "派单请求失败，请稍后重试"
      });
    } finally {
      setDispatching(false);
    }
  }, [dispatchAction, dispatchDriverPoint, dispatchOrderPoint, fetchBoard]);

  useEffect(() => {
    if (!selectedPoint) {
      return;
    }

    const stillVisible = allPoints.some((point) => point.id === selectedPoint.id);
    if (!stillVisible) {
      setSelectedPoint(filteredActivePoints[0] ?? allPoints[0] ?? null);
    }
  }, [allPoints, filteredActivePoints, selectedPoint]);

  useEffect(() => {
    const selectedIsFocused =
      selectedPoint?.kind === activeKind &&
      filteredActivePoints.some((point) => point.id === selectedPoint.id);

    if (!selectedIsFocused) {
      setSelectedPoint(filteredActivePoints[0] ?? null);
    }
  }, [activeKind, filteredActivePoints, selectedPoint]);

  useEffect(() => {
    if (!amapKey || !mapContainerRef.current) {
      setAmapReady(false);
      setMapNotice("未配置高德 JS Key，已启用本地降级视图");
      return;
    }

    let disposed = false;

    async function renderMap() {
      try {
        setMapNotice("正在加载高德地图");
        const amap = await loadAmap(amapKey, amapSecurityCode);

        if (disposed || !mapContainerRef.current) {
          return;
        }

        const isNewMap = !mapRef.current;
        const mapCenter: [number, number] = payload?.mapCenter
          ? [payload.mapCenter.lng, payload.mapCenter.lat]
          : [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat];

        if (isNewMap) {
          mapRef.current = new amap.Map(mapContainerRef.current, {
            center: mapCenter,
            zoom: 12,
            resizeEnable: true,
            viewMode: "2D",
            mapStyle: "amap://styles/normal"
          });
          markersByIdRef.current.forEach((m) => m.setMap(null));
          markersByIdRef.current.clear();
        }

        allPoints.forEach((point) => {
          // 无坐标（FALLBACK）订单不落图，但保留在侧边栏列表
          if (point.coordinate.source === "FALLBACK") {
            const existing = markersByIdRef.current.get(point.id);
            if (existing) {
              existing.setMap(null);
              markersByIdRef.current.delete(point.id);
            }
            return;
          }
          const pos: [number, number] = [point.coordinate.lng, point.coordinate.lat];
          const html = getMarkerContent(point, activeKind, selectedPoint, focusedPointIds);
          const existing = markersByIdRef.current.get(point.id);
          if (existing) {
            existing.setPosition(pos);
            existing.setContent(html);
          } else {
            const marker = new amap.Marker({
              position: pos,
              content: html,
              offset: new amap.Pixel(-18, -18),
              anchor: "center"
            });
            marker.on("click", () => setSelectedPoint(point));
            marker.setMap(mapRef.current);
            markersByIdRef.current.set(point.id, marker);
          }
        });

        markersRef.current = Array.from(markersByIdRef.current.values());

        if (markersRef.current.length > 0 && !hasFittedMapRef.current) {
          mapRef.current?.setFitView(markersRef.current);
          hasFittedMapRef.current = true;
        } else {
          if (!hasFittedMapRef.current) {
            mapRef.current?.setZoomAndCenter(12, mapCenter);
          }
        }

        setAmapReady(true);
        setMapNotice("高德地图已加载");
      } catch {
        setAmapReady(false);
        setMapNotice("高德地图暂不可用，已启用本地降级视图");
      }
    }

    void renderMap();

    return () => {
      disposed = true;
    };
  }, [activeKind, allPoints, amapKey, amapSecurityCode, focusedPointIds, payload, selectedPoint]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      mapRef.current?.destroy();
    };
  }, []);

  function selectKind(kind: BoardKind) {
    setActiveKind(kind);
    setSelectedPoint((current) => {
      if (current?.kind === kind) {
        return current;
      }

      const nextActivePoints = allPoints.filter((point) => point.kind === kind);
      const nextFilteredPoints = filterPoints(
        nextActivePoints,
        keyword,
        timeFilter,
        orderDirectionFilter,
        payload?.generatedAt ?? null
      );

      return nextFilteredPoints[0] ?? null;
    });
  }

  return (
    <div className={styles.viewport}>
      <section className={styles.boardShell}>
      <aside className={styles.navRail} aria-label="调度模块">
        <div className={styles.railBrand}>RCD</div>
        <Link className={styles.railItemActive} href="/admin/map" title="地图看板">
          图
        </Link>
        <Link className={styles.railItem} href="/admin/orders?mode=orders" title="订单池">
          单
        </Link>
        <Link className={styles.railItem} href="/admin/orders?mode=drivers" title="司机管理">
          人
        </Link>
        <Link className={styles.railItem} href="/admin/orders?mode=vehicles" title="车辆管理">
          车
        </Link>
        <Link className={styles.railItem} href="/admin/orders?mode=alerts" title="预警中心">
          警
        </Link>
        <Link className={styles.railItem} href="/admin/orders?mode=logs" title="日志查询">
          日
        </Link>
      </aside>

      <aside className={styles.workPanel}>
        <header className={styles.panelHead}>
          <div>
            <p className={styles.kicker}>地图 · 四类对象联动</p>
            <h1>地图看板</h1>
            <p>筛选选择即生效，点位跟随订单、司机、车辆、门店联动。</p>
          </div>

          <div className={styles.kpiRow}>
            {kindStats.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className={styles.objectTabs}>
            {(["ORDER", "DRIVER", "ALERT", "VEHICLE"] as BoardKind[]).map((kind) => (
              <button
                key={kind}
                className={activeKind === kind ? styles.filterButtonActive : styles.filterButton}
                type="button"
                onClick={() => selectKind(kind)}
              >
                {kindLabels[kind]}
              </button>
            ))}
          </div>

          <div className={styles.panelFilters}>
            <input
              value={keyword}
              placeholder="搜索订单、司机、车牌、门店"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              value={timeFilter}
              onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
            >
              <option value="ALL">全部时间</option>
              <option value="2">2 小时</option>
              <option value="4">4 小时</option>
              <option value="6">6 小时</option>
            </select>
            <select
              value={orderDirectionFilter}
              onChange={(event) =>
                setOrderDirectionFilter(event.target.value as OrderDirectionFilter)
              }
            >
              <option value="ALL">全部状态</option>
              <option value="PICKUP">待取车</option>
              <option value="RETURN">待还车</option>
            </select>
          </div>
        </header>

        <div className={styles.pointList}>
          <div className={styles.listHeader}>
            <span>{kindLabels[activeKind]}列表</span>
            <strong>{filteredActivePoints.length}</strong>
          </div>
          {filteredActivePoints.map((point) => (
            <button
              key={`${point.kind}-list-${point.id}`}
              className={
                selectedPoint?.id === point.id ? styles.pointRowActive : styles.pointRow
              }
              type="button"
              onClick={() => setSelectedPoint(point)}
            >
              <span>{pointShortName[point.kind]}</span>
              <strong>{getPointTitle(point)}</strong>
              <small>{getPointStatus(point)}</small>
              <em>{getPointSubtitle(point)}</em>
            </button>
          ))}
        </div>
      </aside>

      <main className={styles.mapScreen}>
        <section className={styles.mapStage}>
          <div className={styles.mapFrame}>
          <div
            ref={mapContainerRef}
            className={amapReady ? styles.amapCanvas : styles.amapCanvasHidden}
          />

          {!amapReady ? (
            <div className={styles.fallbackMap} aria-label="本地点位视图">
              <div className={styles.gridLineHorizontal} />
              <div className={styles.gridLineVertical} />
              {selectedPoint?.kind === "ORDER" && routePreviewTarget ? (
                <div
                  className={styles.routePreview}
                  style={getRoutePreviewStyle(selectedPoint, routePreviewTarget, allPoints)}
                />
              ) : null}
              {allPoints.map((point) => (
                <button
                  key={`${point.kind}-${point.id}`}
                  className={`${styles.fallbackPoint} ${styles[`point${point.kind}`]} ${
                    selectedPoint?.id === point.id
                      ? styles.fallbackPointSelected
                      : point.kind === activeKind && focusedPointIds.has(point.id)
                        ? styles.fallbackPointActive
                        : styles.fallbackPointDim
                  }`}
                  style={getPointPosition(point, allPoints)}
                  type="button"
                  title={getPointTitle(point)}
                  onClick={() => setSelectedPoint(point)}
                >
                  <span aria-hidden="true" />
                  <em>{pointShortName[point.kind]}</em>
                </button>
              ))}
            </div>
          ) : null}

          <article className={styles.etaPanel} aria-label="导航预计到达">
            <div className={styles.etaHead}>
              <strong>导航预计到达</strong>
            </div>
            <div className={styles.etaList}>
              {etaPlans.map((plan, index) => (
                <div
                  key={plan.rank}
                  className={`${styles.etaOption} ${index === 0 ? styles.etaOptionPrimary : ""}`}
                >
                  <span>{plan.rank}</span>
                  <div>
                    <strong>{plan.title}</strong>
                    <em>{plan.description}</em>
                  </div>
                  <b>{plan.timeText}</b>
                </div>
              ))}
            </div>
          </article>

          <div className={styles.mapStats}>
            {kindStats.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className={styles.mapNotice}>{mapNotice}</div>

          {error ? <div className={styles.errorBanner}>{error}</div> : null}
        </div>

          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => void fetchBoard()}
            disabled={loading}
          >
            {loading ? "刷新中" : "刷新点位"}
          </button>
        </section>

        <section className={styles.bottomDock}>
          <article className={styles.detailCard}>
            <div className={styles.detailHead}>
              <div>
                <p className={styles.kicker}>选中对象</p>
                <h3>{selectedPoint ? getPointTitle(selectedPoint) : "暂无点位"}</h3>
              </div>
              <span>{selectedPoint ? kindLabels[selectedPoint.kind] : "-"}</span>
            </div>

            {selectedPoint ? (
              <>
                <dl className={styles.detailGrid}>
                  <div>
                    <dt>状态</dt>
                    <dd>{getPointStatus(selectedPoint)}</dd>
                  </div>
                  <div>
                    <dt>所属门店</dt>
                    <dd>{selectedPoint.storeName}</dd>
                  </div>
                  <div>
                    <dt>说明</dt>
                    <dd>{getPointSubtitle(selectedPoint)}</dd>
                  </div>
                  {selectedPoint.kind === "ORDER" ? (
                    <>
                      <div>
                        <dt>订单类型</dt>
                        <dd>{getOrderTypeText(selectedPoint)}</dd>
                      </div>
                      <div>
                        <dt>车牌号</dt>
                        <dd>{getOrderPlate(selectedPoint)}</dd>
                      </div>
                      <div>
                        <dt>当前司机</dt>
                        <dd>{getOrderDriverName(selectedPoint, routePreviewTarget?.name)}</dd>
                      </div>
                      <div>
                        <dt>用车时间</dt>
                        <dd>{getOrderTimeRange(selectedPoint)}</dd>
                      </div>
                      <div>
                        <dt>订单进展</dt>
                        <dd>{getOrderProgress(selectedPoint)}</dd>
                      </div>
                      <div>
                        <dt>锁单</dt>
                        <dd>{getOrderLockText(selectedPoint)}</dd>
                      </div>
                    </>
                  ) : null}
                  {selectedPoint.kind === "VEHICLE" ? (
                    <div>
                      <dt>车型</dt>
                      <dd>{selectedPoint.vehicleType}</dd>
                    </div>
                  ) : null}
                  {selectedPoint.kind === "STORE" ? (
                    <div>
                      <dt>门店编码</dt>
                      <dd>{selectedPoint.code}</dd>
                    </div>
                  ) : null}
                  {selectedPoint.kind === "ALERT" ? (
                    <>
                      <div>
                        <dt>关联对象</dt>
                        <dd>{selectedPoint.target}</dd>
                      </div>
                      <div>
                        <dt>超过阈值</dt>
                        <dd>+{selectedPoint.exceededMinutes}m</dd>
                      </div>
                      <div>
                        <dt>阈值</dt>
                        <dd>{selectedPoint.thresholdMinutes}m</dd>
                      </div>
                    </>
                  ) : null}
                </dl>

                {selectedPoint.kind === "ORDER" ? (
                  <div className={styles.detailActions}>
                    <button type="button" className={styles.ghostButton}>
                      查看路径
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      disabled={!routePreviewTarget}
                      onClick={() => routePreviewTarget && setSelectedPoint(routePreviewTarget)}
                    >
                      司机
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      disabled={!dispatchDriverPoint || dispatching}
                      onClick={() => void confirmDispatch()}
                    >
                      {dispatching ? "派单中" : "派单"}
                    </button>
                    <Link className={styles.dangerButton} href="/admin/orders">
                      改派
                    </Link>
                    {dispatchStatus ? (
                      <div className={`${styles.dispatchStatus} ${dispatchStatusClass}`}>
                        {dispatchStatus.message}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.emptyPanel}>当前没有可显示的点位</div>
            )}
          </article>

          <article className={styles.recommendCard}>
            <div className={styles.detailHead}>
              <h3>
                {activeKind === "DRIVER" || selectedPoint?.kind === "DRIVER"
                  ? "推荐订单 Top N"
                  : "推荐派单 Top N"}
              </h3>
              <span>
                {recommendationLoading
                  ? "API 计算中"
                  : recommendationError
                    ? "本地降级"
                    : dispatchRecommendation
                      ? "API 推荐"
                      : "本地候选"}
              </span>
            </div>
            {recommendationError ? (
              <div className={`${styles.dispatchStatus} ${styles.dispatchStatusError}`}>
                {recommendationError}
              </div>
            ) : null}
            <div className={styles.recommendList}>
              {recommendCandidates.map((candidate) => {
                const isCandidateSelected = selectedCandidateId === candidate.id;
                const canPrepareDispatch =
                  selectedPoint?.kind === "ORDER" && candidate.point.kind === "DRIVER";

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`${styles.recommendItem} ${
                      isCandidateSelected ? styles.recommendItemActive : ""
                    }`}
                    onClick={() => {
                      setSelectedCandidateId(candidate.id);
                      setDispatchStatus({
                        kind: "info",
                        message: canPrepareDispatch
                          ? `已选择 ${candidate.title}，请点击派单确认`
                          : `已选择 ${candidate.title}`
                      });
                    }}
                  >
                  <strong>
                    #{candidate.priority} {candidate.title}
                  </strong>
                  <div className={styles.candidateRow}>
                    <span>
                      {activeKind === "DRIVER" || selectedPoint?.kind === "DRIVER"
                        ? "目标司机"
                        : "目标订单"}
                    </span>
                    <span>{candidate.targetText}</span>
                  </div>
                  <div className={styles.candidateRow}>
                    <span>ETA</span>
                    <span>{candidate.etaMinutes >= 0 ? `${candidate.etaMinutes}m` : "无法计算"}</span>
                  </div>
                  <div className={styles.candidateRow}>
                    <span>负载惩罚</span>
                    <span>{candidate.loadPenalty}</span>
                  </div>
                  <div className={styles.candidateRow}>
                    <span>状态</span>
                    <span>{candidate.statusText}</span>
                  </div>
                  <div className={styles.candidateRow}>
                    <span>优先级</span>
                    <span>{candidate.priority}</span>
                  </div>
                  <div className={styles.candidateRow}>
                    <span>结果</span>
                    <span className={styles.outcome}>{candidate.outcome}</span>
                  </div>
                  </button>
                );
              })}
            </div>
          </article>
        </section>
      </main>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { OrderDisplayDTO } from "@/lib/map/order-display-dto";
import type { MapBoardPayload, MapDriverPoint, MapVehiclePoint } from "@/lib/map/types";
import styles from "./orders-workflow.module.css";

type ApiResponse<T> =
  | {
      success: true;
      data: T;
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

type Driver = {
  id: string;
  name: string;
  phone: string;
  status: string;
  isActive?: boolean;
  store?: {
    id: string;
    name: string;
  };
};

type OrderItem = OrderDisplayDTO;

type OrdersPayload = {
  items: OrderItem[];
  total: number;
  page: number;
  pageSize: number;
  drivers: Driver[];
};

type OperationLog = {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  metadataJson: Record<string, unknown> | null;
  operatorUser: {
    name: string;
    email: string;
  };
};

type GlobalLogItem = OperationLog & {
  entityType: string;
  entityId: string;
};

type LogsPayload = {
  items: GlobalLogItem[];
  total: number;
};

type WorkspaceMode = "orders" | "drivers" | "vehicles" | "alerts" | "logs";

type AlertRow = {
  id: string;
  type: string;
  target: string;
  thresholdMinutes: number;
  actualMinutes: number;
  exceededMinutes: number;
  storeName: string;
  description: string;
};

type OrderDetailPayload = {
  order: OrderItem & {
    assignments: Array<{
      id: string;
      type: string;
      status: string;
      assignedAt: string;
      acceptedAt: string | null;
      driver: Driver;
    }>;
  };
  logs: OperationLog[];
};

type RankedCandidate = {
  driverId: string;
  driverName: string;
  driverStatus: string;
  storeName: string;
  etaMinutes: number;
  loadPenaltyMinutes: number;
  priorityRank: number;
  outcome?: string;
};

type DispatchResult = {
  orderId: string;
  orderNo: string;
  orderType: string;
  outcome: "DISPATCHED" | "PENDING" | "MANUAL";
  reason: "NO_DRIVER" | "ETA_EXCEEDED" | null;
  topN: RankedCandidate[];
};

const dispatchOutcomeLabels: Record<DispatchResult["outcome"], string> = {
  DISPATCHED: "可派单",
  PENDING: "待人工分配",
  MANUAL: "需人工处理"
};

const dispatchReasonLabels: Record<NonNullable<DispatchResult["reason"]>, string> = {
  NO_DRIVER: "暂无可用司机",
  ETA_EXCEEDED: "ETA 超过阈值"
};

const statusLabels: Record<string, string> = {
  PENDING: "待分配",
  RECOMMENDING: "推荐中",
  ASSIGNED: "已派单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "执行中",
  COMPLETED: "已完成",
  RECYCLED: "已回收",
  CANCELLED: "已取消",
  OFFLINE: "离线",
  S1: "门店空闲",
  S2: "返程空闲",
  S3: "门店忙碌",
  S4: "订单忙碌",
  UNAVAILABLE: "暂不可用"
};

const orderTypeLabels: Record<string, string> = {
  STORE_PICKUP: "到店取车",
  STORE_RETURN: "到店还车",
  DOOR_DELIVERY: "送车上门",
  DOOR_PICKUP: "上门取车"
};

const orderStatuses = [
  { value: "ALL", label: "全部状态" },
  { value: "PENDING", label: "待分配" },
  { value: "ASSIGNED", label: "已派单" },
  { value: "ACCEPTED", label: "已接单" },
  { value: "IN_PROGRESS", label: "执行中" },
  { value: "RECYCLED", label: "已回收" },
  { value: "CANCELLED", label: "已取消" }
];

const pageSizes = [20, 50, 100];

function getDispatchResultLabel(result: DispatchResult) {
  return result.reason ? dispatchReasonLabels[result.reason] : dispatchOutcomeLabels[result.outcome];
}

const modeCopy: Record<
  WorkspaceMode,
  {
    kicker: string;
    title: string;
    subtitle: string;
    workspaceTitle: string;
    workspaceSubtitle: string;
  }
> = {
  orders: {
    kicker: "订单池 · 外部订单自动传入",
    title: "订单池",
    subtitle: "订单自动传入、入库状态和调度动作在此集中展示。",
    workspaceTitle: "订单调度闭环",
    workspaceSubtitle: "订单明细、调度动作与操作日志在同一工作区完成。"
  },
  drivers: {
    kicker: "司机 · 工单与状态",
    title: "司机管理",
    subtitle: "点击司机卡片查看前后工单、当前订单和订单进展。",
    workspaceTitle: "司机管理信息",
    workspaceSubtitle: "司机状态、工单进度轴和当前订单进展。"
  },
  vehicles: {
    kicker: "车辆 · GPS 与位置同步",
    title: "车辆管理",
    subtitle: "车辆基础信息、GPS 更新时间和是否参与调度在此集中展示。",
    workspaceTitle: "车辆管理信息",
    workspaceSubtitle: "车辆自动传入、GPS 和是否参与调度。"
  },
  alerts: {
    kicker: "预警 · 阈值排序",
    title: "预警中心",
    subtitle: "预警按超过阈值时长降序排列，越久越靠前。",
    workspaceTitle: "预警信息",
    workspaceSubtitle: "不按类型分组，统一按超过阈值时长排序。"
  },
  logs: {
    kicker: "日志 · traceId",
    title: "日志查询",
    subtitle: "按订单号、司机、车牌号和派单、改派等操作追踪时间戳。",
    workspaceTitle: "日志查询信息",
    workspaceSubtitle: "按订单号、司机、车牌号和操作记录派单、改派等时间戳。"
  }
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getStatusLabel(value: string) {
  return statusLabels[value] ?? value;
}

function getOrderTypeLabel(value: string) {
  return orderTypeLabels[value] ?? value;
}

function getOrderGlyph(type: string) {
  return type === "STORE_RETURN" || type === "DOOR_PICKUP" ? "还" : "取";
}

function readApiError<T>(payload: ApiResponse<T>) {
  return payload.success ? null : payload.error;
}

const actionLabels: Record<string, string> = {
  ASSIGN: "派单",
  REASSIGN: "改派",
  WITHDRAW: "撤回",
  ACCEPT: "接单"
};

function getActionLabel(action: string) {
  return actionLabels[action] ?? action;
}

function getActionBadgeClass(action: string) {
  const map: Record<string, string> = {
    ASSIGN: styles.actionLogBadgeAssign,
    REASSIGN: styles.actionLogBadgeReassign,
    WITHDRAW: styles.actionLogBadgeWithdraw,
    ACCEPT: styles.actionLogBadgeAccept
  };
  return map[action] ?? styles.actionLogBadgeDefault;
}

function getMetadataValue(log: OperationLog, key: string) {
  const value = log.metadataJson?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "-";
}

function getMetadataText(log: GlobalLogItem) {
  const metadataValues = Object.values(log.metadataJson ?? {})
    .filter((value): value is string | number | boolean => {
      return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    })
    .map(String);

  return [
    log.id,
    log.action,
    log.reason,
    log.entityType,
    log.entityId,
    log.operatorUser.name,
    log.operatorUser.email,
    ...metadataValues
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getDriverDisplayStatus(status: string) {
  return getStatusLabel(status);
}

function getVehicleDisplayStatus(status: string) {
  const labels: Record<string, string> = {
    AVAILABLE: "可调度",
    PRE_ASSIGNED: "待还车",
    IN_USE: "补能中",
    UNAVAILABLE: "GPS 离线"
  };

  return labels[status] ?? status;
}

function getVehicleGpsStatus(vehicle: MapVehiclePoint) {
  return vehicle.status === "UNAVAILABLE" ? "离线" : "在线";
}

function getVehicleRevenue(index: number) {
  return `${(48600 - index * 3700).toLocaleString("zh-CN")}元`;
}

function buildAlerts(orders: OrderItem[], vehicles: MapVehiclePoint[]): AlertRow[] {
  const orderAlerts = orders
    .filter((order) => order.status === "PENDING" || order.status === "RECOMMENDING")
    .slice(0, 5)
    .map((order, index) => ({
      id: `order-${order.id}`,
      type: "未接单超时",
      target: order.orderNo,
      thresholdMinutes: 15,
      actualMinutes: 63 - index * 7,
      exceededMinutes: 48 - index * 7,
      storeName: order.storeName,
      description: `${order.pickupName} 待派单超过阈值`
    }));

  const vehicleAlerts = vehicles
    .filter((vehicle) => vehicle.status === "UNAVAILABLE")
    .map((vehicle, index) => ({
      id: `vehicle-${vehicle.id}`,
      type: "GPS 离线",
      target: vehicle.licensePlate,
      thresholdMinutes: 30,
      actualMinutes: 104 - index * 11,
      exceededMinutes: 74 - index * 11,
      storeName: vehicle.storeName,
      description: `${vehicle.licensePlate} 车辆定位未更新`
    }));

  return [...orderAlerts, ...vehicleAlerts].sort(
    (left, right) => right.exceededMinutes - left.exceededMinutes
  );
}

function isWorkspaceMode(value: string | null): value is WorkspaceMode {
  return value === "orders" || value === "drivers" || value === "vehicles" || value === "alerts" || value === "logs";
}

export function OrdersWorkflow() {
  const [ordersPayload, setOrdersPayload] = useState<OrdersPayload | null>(null);
  const [mapPayload, setMapPayload] = useState<MapBoardPayload | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedDriverIdForView, setSelectedDriverIdForView] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetailPayload | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [logsPayload, setLogsPayload] = useState<LogsPayload | null>(null);
  const [logsScopedOrderId, setLogsScopedOrderId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [vehicleKeyword, setVehicleKeyword] = useState("");
  const [status, setStatus] = useState("ALL");
  const [pageSize, setPageSize] = useState(20);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [reason, setReason] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("orders");
  const [message, setMessage] = useState("正在加载订单...");
  const [isBusy, setIsBusy] = useState(false);
  const [toasts, setToasts] = useState<
    Array<{ id: string; message: string; type: "success" | "error" | "warning" }>
  >([]);
  const scaleBaseDprRef = useRef(1);
  const selectedOrder = useMemo(() => {
    return (
      detail?.order ??
      ordersPayload?.items.find((order) => order.id === selectedOrderId) ??
      null
    );
  }, [detail?.order, ordersPayload?.items, selectedOrderId]);

  const drivers = ordersPayload?.drivers ?? [];
  const mapDrivers = useMemo(() => mapPayload?.drivers ?? [], [mapPayload?.drivers]);
  const vehicles = useMemo(() => mapPayload?.vehicles ?? [], [mapPayload?.vehicles]);
  const alerts = useMemo(
    () => buildAlerts(ordersPayload?.items ?? [], vehicles),
    [ordersPayload?.items, vehicles]
  );
  const availableDrivers = drivers.filter(
    (driver) => driver.status !== "OFFLINE" && driver.status !== "UNAVAILABLE"
  );
  const assignedCount =
    ordersPayload?.items.filter((order) => order.status === "ASSIGNED").length ?? 0;
  const activeDrivers = drivers.filter(
    (driver) => driver.status !== "OFFLINE" && driver.status !== "UNAVAILABLE"
  ).length;
  const selectedDriverForView =
    mapDrivers.find((driver) => driver.id === selectedDriverIdForView) ?? mapDrivers[0] ?? null;
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null;
  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? alerts[0] ?? null;
  const filteredVehicles = vehicles.filter((vehicle) => {
    const normalized = vehicleKeyword.trim().toLowerCase();

    if (!normalized) {
      return true;
    }

    return [
      vehicle.licensePlate,
      vehicle.vehicleType,
      vehicle.storeName,
      getVehicleGpsStatus(vehicle),
      getVehicleDisplayStatus(vehicle.status)
    ].some((value) => value.toLowerCase().includes(normalized));
  });

  const relatedOrderByDriver = useMemo(() => {
    const grouped = new Map<string, OrderItem>();

    ordersPayload?.items.forEach((order) => {
      const driverId = order.currentAssignment?.driverId;
      if (driverId && !grouped.has(driverId)) {
        grouped.set(driverId, order);
      }
    });

    return grouped;
  }, [ordersPayload?.items]);

  const relatedOrderByPlate = useMemo(() => {
    const grouped = new Map<string, OrderItem>();

    ordersPayload?.items.forEach((order) => {
      if (order.plate && !grouped.has(order.plate)) {
        grouped.set(order.plate, order);
      }
    });

    return grouped;
  }, [ordersPayload?.items]);
  const allLogs = useMemo(() => logsPayload?.items ?? [], [logsPayload?.items]);
  const normalizedLogKeyword = workspaceMode === "logs" ? keyword.trim().toLowerCase() : "";
  const filteredLogs = useMemo(() => {
    if (!normalizedLogKeyword) {
      return allLogs;
    }

    return allLogs.filter((log) => getMetadataText(log).includes(normalizedLogKeyword));
  }, [allLogs, normalizedLogKeyword]);
  const selectedLog = useMemo(() => {
    return selectedLogId
      ? filteredLogs.find((log) => log.id === selectedLogId) ?? null
      : null;
  }, [filteredLogs, selectedLogId]);
  const timelineLogs = useMemo(() => {
    if (!selectedLog) {
      return filteredLogs;
    }

    const selectedOrderNo = getMetadataValue(selectedLog, "orderNo");

    return allLogs.filter((log) => {
      if (log.entityId === selectedLog.entityId) {
        return true;
      }

      return selectedOrderNo !== "-" && getMetadataValue(log, "orderNo") === selectedOrderNo;
    });
  }, [allLogs, filteredLogs, selectedLog]);

  function addToast(message: string, type: "success" | "error" | "warning") {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  useEffect(() => {
    return () => setToasts([]);
  }, []);

  async function loadOrders(nextSelectedOrderId?: string | null) {
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(pageSize),
      status
    });

    if (debouncedKeyword.trim()) {
      params.set("q", debouncedKeyword.trim());
    }

    const response = await fetch(`/api/orders?${params.toString()}`, {
      cache: "no-store"
    });
    const payload = (await response.json()) as ApiResponse<OrdersPayload>;
    if (!payload.success) {
      setMessage(payload.error);
      return;
    }

    setOrdersPayload(payload.data);

    const preferredOrderId = nextSelectedOrderId ?? selectedOrderId;
    const fallbackOrder = payload.data.items[0] ?? null;
    const nextOrder =
      payload.data.items.find((order) => order.id === preferredOrderId) ?? fallbackOrder;

    setSelectedOrderId(nextOrder?.id ?? null);
    setMessage(`已加载 ${payload.data.items.length} 条订单，共 ${payload.data.total} 条`);
  }

  async function loadDetail(orderId: string | null) {
    if (!orderId) {
      setDetail(null);
      return;
    }

    const response = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
    const payload = (await response.json()) as ApiResponse<OrderDetailPayload>;
    if (!payload.success) {
      setMessage(payload.error);
      return;
    }

    setDetail(payload.data);
    setSelectedDriverId(payload.data.order.currentAssignment?.driverId ?? "");
  }

  async function loadLogs(orderId?: string | null) {
    const params = new URLSearchParams({ limit: "60" });
    if (orderId) {
      params.set("orderId", orderId);
    }

    const response = await fetch(`/api/orders/logs?${params.toString()}`, {
      cache: "no-store"
    });
    const payload = (await response.json()) as ApiResponse<LogsPayload>;
    if (!payload.success) {
      setMessage(payload.error);
      return;
    }

    setLogsPayload(payload.data);
  }

  async function loadMapPayload() {
    const response = await fetch("/api/map", { cache: "no-store" });
    const payload = (await response.json()) as ApiResponse<MapBoardPayload>;
    if (!payload.success) {
      setMessage(payload.error);
      return;
    }

    setMapPayload(payload.data);
    setSelectedDriverIdForView((current) => current ?? payload.data.drivers[0]?.id ?? null);
    setSelectedVehicleId((current) => current ?? payload.data.vehicles[0]?.id ?? null);
  }

  async function runAction(
    label: string,
    url: string,
    body: Record<string, string | undefined>
  ) {
    setIsBusy(true);
    setMessage(`${label}处理中...`);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      // 409 冲突：数据已被其他操作修改，自动刷新
      if (response.status === 409) {
        const payload = (await response.json()) as ApiResponse<unknown>;
        const error = readApiError(payload);
        addToast(error ?? "数据已变更，已自动刷新", "warning");
        setMessage(error ?? "数据已变更，已自动刷新");
        await loadOrders(body.orderId ?? selectedOrderId);
        await loadDetail(body.orderId ?? selectedOrderId);
        await loadLogs(body.orderId ?? selectedOrderId);
        setReason("");
        return;
      }

      const payload = (await response.json()) as ApiResponse<unknown>;
      const error = readApiError(payload);

      if (error) {
        setMessage(error);
        addToast(error, "error");
        return;
      }

      setMessage(`${label}成功`);
      addToast(`${label}成功`, "success");
      await loadOrders(body.orderId ?? selectedOrderId);
      await loadDetail(body.orderId ?? selectedOrderId);
      await loadLogs(body.orderId ?? selectedOrderId);
      setReason("");
    } finally {
      setIsBusy(false);
    }
  }

  async function runRecommendDispatch() {
    if (!selectedOrder) {
      setMessage("请选择订单");
      return;
    }

    setIsBusy(true);
    setMessage("推荐派单计算中...");

    try {
      const response = await fetch("/api/dispatch/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          topN: 3
        })
      });
      const payload = (await response.json()) as ApiResponse<DispatchResult>;

      if (!payload.success) {
        setMessage(payload.error);
        return;
      }

      setDispatchResult(payload.data);
      setSelectedDriverId(payload.data.topN[0]?.driverId ?? "");
      setMessage(
        payload.data.outcome === "DISPATCHED"
          ? "推荐派单已生成"
          : `推荐派单需人工处理：${getDispatchResultLabel(payload.data)}`
      );
      await loadOrders(selectedOrder.id);
      await loadDetail(selectedOrder.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmRecommendDispatch(driverId: string) {
    if (!selectedOrder) {
      setMessage("请选择订单");
      return;
    }

    setIsBusy(true);
    setMessage("确认推荐派单处理中...");

    try {
      const response = await fetch("/api/dispatch/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          driverId
        })
      });
      const payload = (await response.json()) as ApiResponse<unknown>;
      const error = readApiError(payload);

      if (error) {
        setMessage(error);
        return;
      }

      setDispatchResult(null);
      setMessage("推荐派单确认成功");
      await loadOrders(selectedOrder.id);
      await loadDetail(selectedOrder.id);
      await loadLogs(selectedOrder.id);
    } finally {
      setIsBusy(false);
    }
  }

  function showOrderLogs(orderId: string) {
    setSelectedOrderId(orderId);
    setLogsScopedOrderId(orderId);
    setSelectedLogId(null);
    setWorkspaceMode("logs");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "logs");
    window.history.replaceState(null, "", nextUrl.toString());
    void loadLogs(orderId);
  }

  function switchMode(mode: WorkspaceMode) {
    setWorkspaceMode(mode);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", mode);
    window.history.replaceState(null, "", nextUrl.toString());
    if (mode === "logs") {
      setLogsScopedOrderId(null);
      setSelectedLogId(null);
      void loadLogs(null);
    }
  }

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("mode");
    if (isWorkspaceMode(mode)) {
      setWorkspaceMode(mode);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedKeyword(keyword);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [keyword]);

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const tokenNames = [
      "--design-w",
      "--design-h",
      "--app-scale",
      "--panel-head-h",
      "--list-content-w",
      "--list-scrollbar-w",
      "--card-action-h"
    ];
    const previousValues = new Map(
      tokenNames.map((name) => [name, rootStyle.getPropertyValue(name)])
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
    }

    updateViewportScale();
    window.addEventListener("resize", updateViewportScale);

    return () => {
      window.removeEventListener("resize", updateViewportScale);
      previousValues.forEach((value, name) => {
        if (value) {
          rootStyle.setProperty(name, value);
        } else {
          rootStyle.removeProperty(name);
        }
      });
    };
  }, []);

  useEffect(() => {
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKeyword, status, pageSize]);

  useEffect(() => {
    if (workspaceMode === "drivers" || workspaceMode === "vehicles" || workspaceMode === "alerts") {
      void loadMapPayload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode]);

  useEffect(() => {
    void loadDetail(selectedOrderId);
    setDispatchResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

  useEffect(() => {
    if (workspaceMode === "logs") {
      void loadLogs(logsScopedOrderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode, logsScopedOrderId]);

  const activeCopy = modeCopy[workspaceMode];
  const modeKpis = {
    orders: [
      ["当前显示", ordersPayload?.items.length ?? 0],
      ["待处理订单", ordersPayload?.total ?? 0],
      ["已派单", assignedCount]
    ],
    drivers: [
      ["司机总数", drivers.length],
      ["可调度司机", activeDrivers],
      ["离线/不可用", drivers.length - activeDrivers]
    ],
    vehicles: [
      ["车辆总数", vehicles.length],
      ["可参与调度", vehicles.filter((vehicle) => vehicle.status !== "UNAVAILABLE").length],
      ["GPS 离线", vehicles.filter((vehicle) => vehicle.status === "UNAVAILABLE").length]
    ],
    alerts: [
      ["预警总数", alerts.length],
      ["超阈值预警", alerts.length],
      ["最长超阈值", `${alerts[0]?.exceededMinutes ?? 0}m`]
    ],
    logs: [
      ["日志条数", filteredLogs.length],
      [
        "改派记录",
        filteredLogs.filter((log) => log.action === "REASSIGN").length
      ],
      [
        "traceId",
        new Set(filteredLogs.map((log) => getMetadataValue(log, "traceId"))).size
      ]
    ]
  }[workspaceMode];
  const apiContracts = {
    orders: [
      ["订单池", "GET /api/orders"],
      ["推荐派单", "POST /api/dispatch/recommend"],
      ["确认派单", "POST /api/dispatch/confirm"],
      ["订单详情", "GET /api/orders/:id"]
    ],
    drivers: [
      ["司机列表", "GET /api/map"],
      ["司机工单", "GET /api/orders"],
      ["调度参与", "S1/S2/S3/S4"]
    ],
    vehicles: [
      ["车辆列表", "GET /api/map"],
      ["车辆传入", "POST /api/vehicles/ingest"],
      ["GPS mock", "GET /api/adapters/gps/mock"]
    ],
    alerts: [
      ["预警查询", "GET /api/map"],
      ["排序字段", "exceededMinutes"],
      ["处置", "仅记录日志"]
    ],
    logs: [
      ["日志查询", "GET /api/orders/logs"],
      ["traceId", "X-Trace-Id"],
      ["范围", "派单/改派/撤回"]
    ]
  }[workspaceMode];

  return (
    <section className={styles.viewport}>
      <div className={styles.appShell}>
        <nav className={styles.navRail} aria-label="后台模块导航">
          <div className={styles.railBrand}>RCD</div>
          <Link href="/admin/map" className={styles.railItem} title="地图看板">
            图
          </Link>
          <button
            type="button"
            className={workspaceMode === "orders" ? styles.railItemActive : styles.railItem}
            title="订单池"
            onClick={() => switchMode("orders")}
          >
            单
          </button>
          <button
            type="button"
            className={workspaceMode === "drivers" ? styles.railItemActive : styles.railItem}
            title="司机管理"
            onClick={() => switchMode("drivers")}
          >
            人
          </button>
          <button
            type="button"
            className={workspaceMode === "vehicles" ? styles.railItemActive : styles.railItem}
            title="车辆管理"
            onClick={() => switchMode("vehicles")}
          >
            车
          </button>
          <button
            type="button"
            className={workspaceMode === "alerts" ? styles.railItemActive : styles.railItem}
            title="预警中心"
            onClick={() => switchMode("alerts")}
          >
            警
          </button>
          <button
            type="button"
            className={workspaceMode === "logs" ? styles.railItemActive : styles.railItem}
            title="日志查询"
            onClick={() => switchMode("logs")}
          >
            日
          </button>
        </nav>

        <aside className={styles.workPanel}>
          <header className={styles.panelHead}>
            <p className={styles.kicker}>{activeCopy.kicker}</p>
            <h1>{activeCopy.title}</h1>
            <p>{activeCopy.subtitle}</p>

            <div className={styles.kpiRow}>
              {modeKpis.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <div className={styles.objectTabs}>
              <button
                type="button"
                className={workspaceMode === "orders" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => switchMode("orders")}
              >
                订单
              </button>
              <button
                type="button"
                className={workspaceMode === "drivers" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => switchMode("drivers")}
              >
                司机
              </button>
              <button
                type="button"
                className={workspaceMode === "alerts" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => switchMode("alerts")}
              >
                预警
              </button>
              <button
                type="button"
                className={workspaceMode === "vehicles" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => switchMode("vehicles")}
              >
                车辆
              </button>
            </div>

            <div className={styles.panelFilters}>
              <input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  if (workspaceMode === "logs") {
                    setSelectedLogId(null);
                  }
                }}
                placeholder="搜索订单、司机、车牌、门店"
              />
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {orderStatuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.panelFilters}>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    每页 {size} 条
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setKeyword("");
                  setStatus("ALL");
                }}
              >
                重置筛选
              </button>
            </div>
          </header>

          <main className={styles.listWrap} id="orders-list">
            <div className={styles.listContent}>
              {workspaceMode === "orders"
                ? ordersPayload?.items.map((order) => (
                    <article
                      key={order.id}
                      className={
                        selectedOrderId === order.id ? styles.orderCardActive : styles.orderCard
                      }
                    >
                      <button
                        type="button"
                        className={styles.cardMain}
                        onClick={() => {
                          setSelectedOrderId(order.id);
                          switchMode("orders");
                        }}
                      >
                        <span className={styles.orderGlyph}>{getOrderGlyph(order.type)}</span>
                        <span className={styles.cardCopy}>
                          <span>
                            <strong>
                              {order.orderNo} · {order.plate}
                            </strong>
                            <em>{order.displayStatus}</em>
                          </span>
                          <small>
                            {formatClock(order.scheduledStartAt)}-
                            {formatClock(order.scheduledEndAt)} · {order.storeName}
                          </small>
                          <small>
                            {order.pickupName} → {order.returnName}
                          </small>
                          <small>
                            入库 {formatDateTime(order.insertedAt)} · {order.traceId}
                          </small>
                        </span>
                      </button>
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => showOrderLogs(order.id)}
                        >
                          查看日志
                        </button>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => {
                            setSelectedOrderId(order.id);
                            switchMode("orders");
                          }}
                        >
                          {order.currentAssignment ? "司机" : "派单"}
                        </button>
                      </div>
                    </article>
                  ))
                : null}

              {workspaceMode === "drivers"
                ? mapDrivers.map((driver) => {
                    const currentOrder = relatedOrderByDriver.get(driver.id);

                    return (
                      <article
                        key={driver.id}
                        className={
                          selectedDriverForView?.id === driver.id
                            ? styles.orderCardActive
                            : styles.orderCard
                        }
                      >
                        <button
                          type="button"
                          className={styles.cardMain}
                          onClick={() => setSelectedDriverIdForView(driver.id)}
                        >
                          <span className={styles.orderGlyph}>司</span>
                          <span className={styles.cardCopy}>
                            <span>
                              <strong>{driver.name}</strong>
                              <em>{getDriverDisplayStatus(driver.status)}</em>
                            </span>
                            <small>{driver.storeName} · 当前 {currentOrder?.orderNo ?? "无订单"}</small>
                            <small>参与调度：{driver.status === "OFFLINE" || driver.status === "UNAVAILABLE" ? "否" : "是"}</small>
                          </span>
                        </button>
                      </article>
                    );
                  })
                : null}

              {workspaceMode === "vehicles"
                ? filteredVehicles.map((vehicle) => {
                    const currentOrder = relatedOrderByPlate.get(vehicle.licensePlate);

                    return (
                      <article
                        key={vehicle.id}
                        className={
                          selectedVehicle?.id === vehicle.id ? styles.orderCardActive : styles.orderCard
                        }
                      >
                        <button
                          type="button"
                          className={styles.cardMain}
                          onClick={() => setSelectedVehicleId(vehicle.id)}
                        >
                          <span className={styles.orderGlyph}>车</span>
                          <span className={styles.cardCopy}>
                            <span>
                              <strong>{vehicle.licensePlate}</strong>
                              <em>{getVehicleDisplayStatus(vehicle.status)}</em>
                            </span>
                            <small>{vehicle.vehicleType} · {vehicle.storeName}</small>
                            <small>GPS {getVehicleGpsStatus(vehicle)} · 当前 {currentOrder?.orderNo ?? "无订单"}</small>
                          </span>
                        </button>
                      </article>
                    );
                  })
                : null}

              {workspaceMode === "alerts"
                ? alerts.map((alert) => (
                    <article
                      key={alert.id}
                      className={selectedAlert?.id === alert.id ? styles.orderCardActive : styles.orderCard}
                    >
                      <button
                        type="button"
                        className={styles.cardMain}
                        onClick={() => setSelectedAlertId(alert.id)}
                      >
                        <span className={styles.orderGlyph}>警</span>
                        <span className={styles.cardCopy}>
                          <span>
                            <strong>{alert.type}</strong>
                            <em>+{alert.exceededMinutes}m</em>
                          </span>
                          <small>{alert.target} · {alert.storeName}</small>
                          <small>{alert.description}</small>
                        </span>
                      </button>
                    </article>
                  ))
                : null}

              {workspaceMode === "logs"
                ? filteredLogs.slice(0, 20).map((log) => (
                    <article
                      key={log.id}
                      className={selectedLog?.id === log.id ? styles.orderCardActive : styles.orderCard}
                    >
                      <button
                        type="button"
                        className={styles.cardMain}
                        onClick={() => setSelectedLogId(log.id)}
                      >
                        <span className={styles.orderGlyph}>日</span>
                        <span className={styles.cardCopy}>
                          <span>
                            <strong>{log.action}</strong>
                            <em>{formatDateTime(log.createdAt)}</em>
                          </span>
                          <small>{getMetadataValue(log, "orderNo")} · {getMetadataValue(log, "driverName")}</small>
                          <small>{getMetadataValue(log, "licensePlate")} · {getMetadataValue(log, "traceId")}</small>
                        </span>
                      </button>
                    </article>
                  ))
                : null}

              {workspaceMode === "orders" && !ordersPayload?.items.length ? (
                <div className={styles.emptyState}>暂无可展示订单。</div>
              ) : null}
              {workspaceMode === "drivers" && !mapDrivers.length ? (
                <div className={styles.emptyState}>暂无司机数据。</div>
              ) : null}
              {workspaceMode === "vehicles" && !filteredVehicles.length ? (
                <div className={styles.emptyState}>暂无车辆数据。</div>
              ) : null}
              {workspaceMode === "alerts" && !alerts.length ? (
                <div className={styles.emptyState}>暂无预警。</div>
              ) : null}
              {workspaceMode === "logs" && !filteredLogs.length ? (
                <div className={styles.emptyState}>暂无操作日志。</div>
              ) : null}
            </div>
          </main>

          <footer className={styles.panelFoot}>
            <span>{message}</span>
          </footer>
        </aside>

        <main className={styles.workspace}>
          <header className={styles.workspaceHead}>
            <div>
              <h2>{activeCopy.workspaceTitle}</h2>
              <p>{activeCopy.workspaceSubtitle}</p>
            </div>
            <div className={styles.apiPills}>
              {apiContracts.map(([label, value]) => (
                <span key={label}>
                  {label}
                  <strong>{value}</strong>
                </span>
              ))}
            </div>
          </header>

          {workspaceMode === "logs" ? (
            <section className={styles.infoWorkspace}>
              <div className={styles.tableCardWide}>
                <div className={styles.cardTitle}>
                  <div>
                    <h3>{selectedLog ? "日志时间轴" : "操作日志"}</h3>
                    <p>
                      {selectedLog
                        ? `${getMetadataValue(selectedLog, "orderNo")} · ${getMetadataValue(selectedLog, "driverName")} · 按时间戳展示关联操作。`
                        : normalizedLogKeyword
                          ? `已按“${keyword.trim()}”过滤相关订单、司机、车牌和 traceId。`
                          : "改派、派单、撤回等操作按时间戳和 traceId 留痕。"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                      setKeyword("");
                      setSelectedLogId(null);
                      setLogsScopedOrderId(null);
                      void loadLogs(null);
                    }}
                  >
                    查看全部
                  </button>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.orderTable}>
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>动作</th>
                        <th>订单</th>
                        <th>司机</th>
                        <th>车牌</th>
                        <th>操作员</th>
                        <th>traceId</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedLog ? timelineLogs : filteredLogs).map((log) => (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLogId(log.id)}
                        >
                          <td>{formatDateTime(log.createdAt)}</td>
                          <td>{log.action}</td>
                          <td>{getMetadataValue(log, "orderNo")}</td>
                          <td>{getMetadataValue(log, "driverName")}</td>
                          <td>{getMetadataValue(log, "licensePlate")}</td>
                          <td>{log.operatorUser.name}</td>
                          <td>{getMetadataValue(log, "traceId")}</td>
                          <td>{log.reason ?? "成功"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : workspaceMode === "drivers" ? (
            <section className={styles.infoWorkspace}>
              <div className={styles.tableCardWide}>
                <div className={styles.cardTitle}>
                  <div>
                    <h3>前后工单进度轴</h3>
                    <p>每名司机一行，状态点向右推进，右侧展示预计完成时间。</p>
                  </div>
                </div>
                <div className={styles.timelineList}>
                  {mapDrivers.map((driver, index) => {
                    const currentOrder = relatedOrderByDriver.get(driver.id);
                    const nextOrder = ordersPayload?.items[index + 1];
                    const isUnavailable =
                      driver.status === "OFFLINE" || driver.status === "UNAVAILABLE";

                    return (
                      <button
                        key={driver.id}
                        type="button"
                        className={
                          selectedDriverForView?.id === driver.id
                            ? styles.timelineRowActive
                            : styles.timelineRow
                        }
                        onClick={() => setSelectedDriverIdForView(driver.id)}
                      >
                        <span>
                          <strong>{driver.name}</strong>
                          <small>{driver.storeName}</small>
                        </span>
                        <div className={styles.timelineAxis}>
                          <i className={styles.timelineDone} />
                          <i className={isUnavailable ? styles.timelineMuted : styles.timelinePulse} />
                          <i />
                        </div>
                        <span>
                          <small>前序工单</small>
                          <strong>{ordersPayload?.items[index - 1]?.orderNo ?? "无"}</strong>
                        </span>
                        <span>
                          <small>当前负责</small>
                          <strong>{currentOrder?.orderNo ?? "待分配"}</strong>
                        </span>
                        <span>
                          <small>后续工单</small>
                          <strong>{nextOrder?.orderNo ?? "无"}</strong>
                        </span>
                        <span>
                          <small>预计完成</small>
                          <strong>{currentOrder ? formatClock(currentOrder.scheduledEndAt) : "--"}</strong>
                        </span>
                      </button>
                    );
                  })}
                  {!mapDrivers.length ? (
                    <div className={styles.emptyState}>暂无司机工单数据。</div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : workspaceMode === "vehicles" ? (
            <section className={styles.infoWorkspace}>
              <div className={styles.tableCardWide}>
                <div className={styles.cardTitle}>
                  <div>
                    <h3>车辆明细</h3>
                    <p>每辆车占一行，车辆 API 数据用于联动车辆管理与调度判断。</p>
                  </div>
                  <input
                    className={styles.workspaceSearch}
                    value={vehicleKeyword}
                    onChange={(event) => setVehicleKeyword(event.target.value)}
                    placeholder="搜索车牌号、车型、门店、GPS 状态"
                  />
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.orderTable}>
                    <thead>
                      <tr>
                        <th>车牌号</th>
                        <th>车型</th>
                        <th>当前所属门店</th>
                        <th>车辆状态</th>
                        <th>GPS 状态</th>
                        <th>GPS 更新时间</th>
                        <th>当前订单</th>
                        <th>本月完单</th>
                        <th>累计营收</th>
                        <th>当前位置</th>
                        <th>参与调度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVehicles.map((vehicle, index) => {
                        const currentOrder = relatedOrderByPlate.get(vehicle.licensePlate);

                        return (
                          <tr
                            key={vehicle.id}
                            className={selectedVehicle?.id === vehicle.id ? styles.selectedRow : ""}
                            onClick={() => setSelectedVehicleId(vehicle.id)}
                          >
                            <td>{vehicle.licensePlate}</td>
                            <td>{vehicle.vehicleType}</td>
                            <td>{vehicle.storeName}</td>
                            <td>{getVehicleDisplayStatus(vehicle.status)}</td>
                            <td>{getVehicleGpsStatus(vehicle)}</td>
                            <td>{formatClock(mapPayload?.generatedAt ?? new Date().toISOString())}</td>
                            <td>{currentOrder?.orderNo ?? "无"}</td>
                            <td>{42 - index * 3} 单</td>
                            <td>{getVehicleRevenue(index)}</td>
                            <td>{vehicle.coordinate.source === "MOCK" ? vehicle.storeName : "实时 GPS"}</td>
                            <td>{vehicle.status === "UNAVAILABLE" ? "否" : "是"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : workspaceMode === "alerts" ? (
            <section className={styles.infoWorkspace}>
              <div className={styles.tableCardWide}>
                <div className={styles.cardTitle}>
                  <div>
                    <h3>预警排序</h3>
                    <p>不按类型分组，统一按超过阈值时长降序排列。</p>
                  </div>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.orderTable}>
                    <thead>
                      <tr>
                        <th>预警</th>
                        <th>对象</th>
                        <th>门店</th>
                        <th>阈值</th>
                        <th>已持续</th>
                        <th>超阈值</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((alert) => (
                        <tr
                          key={alert.id}
                          className={selectedAlert?.id === alert.id ? styles.selectedRow : ""}
                          onClick={() => setSelectedAlertId(alert.id)}
                        >
                          <td>{alert.type}</td>
                          <td>{alert.target}</td>
                          <td>{alert.storeName}</td>
                          <td>{alert.thresholdMinutes}m</td>
                          <td>{alert.actualMinutes}m</td>
                          <td>{alert.exceededMinutes}m</td>
                          <td>{alert.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : (
            <section className={styles.infoWorkspace}>
              <div className={styles.tableCard}>
                <div className={styles.cardTitle}>
                  <div>
                    <h3>订单明细</h3>
                    <p>每个订单占一行，宽字段通过横向轨道查看。</p>
                  </div>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.orderTable}>
                    <thead>
                      <tr>
                        <th>订单号</th>
                        <th>类型</th>
                        <th>订单状态</th>
                        <th>车牌号</th>
                        <th>门店</th>
                        <th>当前司机</th>
                        <th>用车时间段</th>
                        <th>取车地址</th>
                        <th>还车地址</th>
                        <th>锁单</th>
                        <th>来源</th>
                        <th>进展</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersPayload?.items.map((order) => (
                        <tr
                          key={order.id}
                          className={selectedOrderId === order.id ? styles.selectedRow : ""}
                          onClick={() => setSelectedOrderId(order.id)}
                        >
                          <td>{order.orderNo}</td>
                          <td>{order.typeText}</td>
                          <td>{order.displayStatus}</td>
                          <td>{order.plate}</td>
                          <td>{order.storeName}</td>
                          <td>{order.driverName ?? "未派单"}</td>
                          <td>
                            {formatDateTime(order.scheduledStartAt)}-
                            {formatDateTime(order.scheduledEndAt)}
                          </td>
                          <td>{order.pickupAddress}</td>
                          <td>{order.returnAddress}</td>
                          <td>{order.locked ? "是" : "否"}</td>
                          <td>{order.source}</td>
                          <td>{order.progressText}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.inlineButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                showOrderLogs(order.id);
                              }}
                            >
                              日志
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.workflowGrid}>
                <section className={styles.detailCard}>
                  {selectedOrder ? (
                    <>
                      <div className={styles.detailHead}>
                        <div>
                          <h3>
                            {selectedOrder.orderNo} · {selectedOrder.plate}
                          </h3>
                          <p>订单详情与调度操作。</p>
                        </div>
                        <span>{selectedOrder.displayStatus}</span>
                      </div>
                      <div className={styles.fieldGrid}>
                        <div>
                          <span>订单状态</span>
                          <strong>{selectedOrder.displayStatus}</strong>
                        </div>
                        <div>
                          <span>当前司机</span>
                          <strong>
                            {selectedOrder.driverName ?? "未派单"}
                          </strong>
                        </div>
                        <div>
                          <span>锁单</span>
                          <strong>{selectedOrder.locked ? "是" : "否"}</strong>
                        </div>
                        <div>
                          <span>订单进展</span>
                          <strong>{selectedOrder.progressText}</strong>
                        </div>
                      </div>
                      <div className={styles.actionGrid}>
                        <select
                          value={selectedDriverId}
                          onChange={(event) => setSelectedDriverId(event.target.value)}
                        >
                          <option value="">选择司机</option>
                          {availableDrivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                              {driver.name} · {getStatusLabel(driver.status)} ·{" "}
                              {driver.store?.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder={
                            selectedOrder.status === "PENDING"
                              ? "备注（选填）"
                              : "改派原因（必填）"
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            isBusy ||
                            (selectedOrder.status !== "PENDING" &&
                              selectedOrder.status !== "RECOMMENDING")
                          }
                          className={styles.actionButton}
                          onClick={() => void runRecommendDispatch()}
                        >
                          推荐派单
                        </button>
                        <button
                          type="button"
                          disabled={
                            isBusy ||
                            !selectedDriverId ||
                            (selectedOrder.status !== "PENDING" &&
                              selectedOrder.status !== "ASSIGNED" &&
                              selectedOrder.status !== "ACCEPTED") ||
                            (selectedOrder.status !== "PENDING" && !reason.trim())
                          }
                          className={styles.actionButton}
                          onClick={() => {
                            const isReassign =
                              selectedOrder.status === "ASSIGNED" ||
                              selectedOrder.status === "ACCEPTED";
                            runAction(
                              isReassign ? "改派" : "派单",
                              isReassign
                                ? "/api/assignments/reassign"
                                : "/api/assignments",
                              {
                                orderId: selectedOrder.id,
                                driverId: selectedDriverId,
                                ...(isReassign ? { reason } : {})
                              }
                            );
                          }}
                        >
                          派单
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || selectedOrder.status !== "ASSIGNED"}
                          className={styles.dangerButton}
                          onClick={() =>
                            runAction("撤回", "/api/assignments/withdraw", {
                              orderId: selectedOrder.id,
                              reason
                            })
                          }
                        >
                          撤回
                        </button>
                      </div>
                      {detail?.logs && detail.logs.length > 0 && (
                        <div className={styles.actionLogTimeline}>
                          {detail.logs.slice(0, 6).map((log) => (
                            <article key={log.id}>
                              <span
                                className={`${styles.actionLogBadge} ${
                                  getActionBadgeClass(log.action)
                                }`}
                              >
                                {getActionLabel(log.action)}
                              </span>
                              <time>{formatDateTime(log.createdAt)}</time>
                              <span>{log.operatorUser.name}{log.reason ? ` · ${log.reason}` : ""}</span>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={styles.emptyState}>请选择订单。</div>
                  )}
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.detailHead}>
                    <div>
                      <h3>推荐派单 Top N</h3>
                      <p>ETA、负载惩罚和结果由调度引擎返回。</p>
                    </div>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => selectedOrderId && showOrderLogs(selectedOrderId)}
                    >
                      查看日志
                    </button>
                  </div>
                  <div className={styles.recommendPanel}>
                    {dispatchResult?.topN.length ? (
                      <div className={styles.candidateGrid}>
                        {dispatchResult.topN.map((candidate, index) => (
                          <article
                            key={candidate.driverId}
                            className={
                              selectedDriverId === candidate.driverId
                                ? styles.candidateCardActive
                                : styles.candidateCard
                            }
                          >
                            <button
                              type="button"
                              className={styles.candidateMain}
                              onClick={() => setSelectedDriverId(candidate.driverId)}
                            >
                              <strong>
                                #{index + 1} {candidate.driverName}
                              </strong>
                              <span>{getStatusLabel(candidate.driverStatus)}</span>
                            </button>
                            <div className={styles.candidateMeta}>
                              <span>优先级</span>
                              <strong>{candidate.priorityRank}</strong>
                              <span>ETA</span>
                              <strong>{candidate.etaMinutes}m</strong>
                              <span>负载惩罚</span>
                              <strong>{candidate.loadPenaltyMinutes}</strong>
                              <span>结果</span>
                              <strong>{getDispatchResultLabel(dispatchResult)}</strong>
                            </div>
                            <button
                              type="button"
                              className={styles.inlineButton}
                              disabled={
                                isBusy ||
                                dispatchResult.outcome !== "DISPATCHED" ||
                                selectedOrder?.status === "ASSIGNED"
                              }
                              onClick={() => void confirmRecommendDispatch(candidate.driverId)}
                            >
                              派单
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyState}>点击推荐派单生成候选司机。</div>
                    )}
                  </div>
                  <div className={styles.localLogs}>
                    {detail?.logs.length ? (
                      detail.logs.map((log) => (
                        <article key={log.id}>
                          <strong>{log.action}</strong>
                          <span>{log.operatorUser.name}</span>
                          <span>{log.reason ?? "无原因"}</span>
                          <time>{formatDateTime(log.createdAt)}</time>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>暂无当前订单日志。</div>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}
        </main>
      </div>
      {toasts.length > 0 && (
        <div className={styles.toastContainer}>
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`${styles.toast} ${
                toast.type === "success"
                  ? styles.toastSuccess
                  : toast.type === "warning"
                    ? styles.toastWarning
                    : styles.toastError
              }`}
            >
              <div className={styles.toastBar} />
              <span className={styles.toastMessage}>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DRIVER_SERVICE_MODULES } from "@/lib/driver-v2/service-modules";

import { DriverGpsTracker } from "./driver-gps-tracker";
import {
  DRIVER_READ_INTERVAL_MS,
  endDriverShift,
  fetchDriverWorkspace,
  runDriverTaskAction,
  updateDriverTaskModules
} from "./driver-h5-entry";
import { DriverMap, type DriverMapMarker } from "./driver-map";
import {
  getTaskNavigationTarget,
  getVisibleDisplayValue
} from "./driver-task-display";

import type { DriverOrderMarkerViewV2 } from "@/lib/driver-v2/types";
import type {
  DriverTaskV2,
  GeoPointV2,
  OrderFeasibilityV2,
  ServiceModuleV2
} from "@/types/v2";
import type { DriverWorkspaceData } from "./driver-h5-entry";

const EMPTY_WORKSPACE: DriverWorkspaceData = {
  drivers: [],
  tasks: [],
  unassignedOrders: []
};

const MODULE_LABELS: Record<ServiceModuleV2, string> = {
  CHARGING: "充电",
  REFUELING: "加油",
  WASHING: "清洗",
  HANDOVER_FORMALITIES: "交车手续",
  RETURN_FORMALITIES: "还车手续"
};

const BUSINESS_LABELS: Record<string, string> = {
  STORE_PICKUP: "门店取车",
  STORE_RETURN: "门店还车",
  DOOR_DELIVERY: "送车上门",
  DOOR_PICKUP: "上门取车"
};

const STATUS_LABELS: Record<DriverTaskV2["executionStatus"], string> = {
  PLANNED: "待出发",
  EN_ROUTE: "前往中",
  IN_SERVICE: "服务中"
};

const FEASIBILITY_LABELS: Record<OrderFeasibilityV2, string> = {
  NORMAL: "时效正常",
  AT_RISK: "存在迟到风险",
  INFEASIBLE: "当前计划不可行",
  UNKNOWN: "时效尚未评估"
};

export const DRIVER_ACCESSIBLE_COLOR_CLASSES = {
  unassignedActive: "bg-[var(--warning)] text-[var(--accent-ink)]",
  completeAction: "bg-[var(--success)] text-[var(--surface)]"
} as const;

export function createLatestResponseGate() {
  let latestRequestId = 0;
  return {
    beginRequest() {
      latestRequestId += 1;
      return latestRequestId;
    },
    commitIfLatest(requestId: number, commit: () => void) {
      if (requestId !== latestRequestId) return false;
      commit();
      return true;
    }
  };
}

function getTaskPoint(task: DriverTaskV2): GeoPointV2 | undefined {
  return getTaskNavigationTarget(task.businessType) === "PICKUP"
    ? task.pickupPoint
    : task.deliveryPoint;
}

function buildNavigationUrl(task: DriverTaskV2) {
  const point = getTaskPoint(task);
  if (!point) return null;
  return `https://uri.amap.com/navigation?to=${point.lng},${point.lat}&mode=car&callnative=1`;
}

function visible(value: string | undefined, fallback: string) {
  return getVisibleDisplayValue(value) ?? fallback;
}

function TaskCard({
  task,
  selected,
  onSelect,
  onChanged
}: {
  task: DriverTaskV2;
  selected: boolean;
  onSelect(): void;
  onChanged(): Promise<void>;
}) {
  const [modules, setModules] = useState<ServiceModuleV2[]>(
    task.servicePlan?.modules ?? []
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const persistedModulesKey = (task.servicePlan?.modules ?? []).join("|");
  const navigationUrl = buildNavigationUrl(task);
  const targetAddress =
    getTaskNavigationTarget(task.businessType) === "PICKUP"
      ? task.pickupAddress
      : task.deliveryAddress;

  useEffect(() => {
    setModules(
      persistedModulesKey
        ? (persistedModulesKey.split("|") as ServiceModuleV2[])
        : []
    );
  }, [persistedModulesKey]);

  function toggleModule(module: ServiceModuleV2) {
    setModules((current) =>
      current.includes(module)
        ? current.filter((item) => item !== module)
        : [...current, module]
    );
  }

  async function runAction(action: "depart" | "arrive" | "complete") {
    setBusy(true);
    setMessage(null);
    try {
      await runDriverTaskAction(task.id, action);
      await onChanged();
      if (action === "depart" && navigationUrl) {
        window.location.assign(navigationUrl);
      }
    } catch {
      setMessage("操作未完成，请刷新后重试");
    } finally {
      setBusy(false);
    }
  }

  async function saveModules() {
    setBusy(true);
    setMessage(null);
    try {
      await updateDriverTaskModules(task.id, modules);
      await onChanged();
      setMessage("服务模块已保存，路线正在重排");
    } catch {
      setMessage("模块保存失败，请刷新后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      id={`driver-item-${task.id}`}
      className={`min-w-0 scroll-mt-4 rounded-2xl border bg-[var(--surface)] p-4 shadow-sm transition ${
        selected
          ? "border-[var(--accent)] ring-2 ring-[var(--line)]"
          : "border-[var(--line)]"
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nav)] text-sm font-bold text-[var(--on-nav)]">
              {task.slot}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {visible(task.orderNo, "任务")}
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                {BUSINESS_LABELS[task.businessType] ?? task.businessType}
              </p>
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--info)_13%,var(--surface))] px-2.5 py-1 text-xs font-medium text-[color-mix(in_srgb,var(--info)_80%,var(--ink))]">
          {STATUS_LABELS[task.executionStatus]}
        </span>
      </div>

      <div className="mt-4 min-w-0 rounded-xl bg-[color-mix(in_srgb,var(--panel)_50%,var(--surface))] p-3">
        <p className="break-words text-sm text-[var(--text-primary)]">
          {visible(targetAddress, "地址待补充")}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
          <span>{new Date(task.promisedPickupAt).toLocaleString("zh-CN")}</span>
          <span>{task.lockType === "NONE" ? "未锁定" : "任务已锁定"}</span>
          <span>{FEASIBILITY_LABELS[task.feasibility]}</span>
        </div>
      </div>

      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="mt-3 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
      >
        在地图查看
      </button>

      <fieldset className="mt-4 min-w-0">
        <legend className="text-xs font-medium text-[var(--text-secondary)]">
          服务模块
        </legend>
        <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
          {DRIVER_SERVICE_MODULES.map((module) => (
            <label
              key={module}
              className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)]"
            >
              <input
                type="checkbox"
                checked={modules.includes(module)}
                onChange={() => toggleModule(module)}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 break-words">
                {MODULE_LABELS[module]}
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveModules()}
          className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
        >
          保存服务模块
        </button>
      </fieldset>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2">
        {task.executionStatus === "PLANNED" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("depart")}
            className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
          >
            出发并导航
          </button>
        ) : null}
        {task.executionStatus === "EN_ROUTE" ? (
          <>
            {navigationUrl ? (
              <a
                href={navigationUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--info)_42%,var(--line))] bg-[color-mix(in_srgb,var(--info)_13%,var(--surface))] px-4 text-sm font-medium text-[color-mix(in_srgb,var(--info)_80%,var(--ink))]"
              >
                继续导航
              </a>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction("arrive")}
              className="min-h-11 rounded-xl bg-[var(--nav)] px-4 text-sm font-semibold text-[var(--on-nav)] disabled:opacity-50"
            >
              确认到达
            </button>
          </>
        ) : null}
        {task.executionStatus === "IN_SERVICE" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("complete")}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${DRIVER_ACCESSIBLE_COLOR_CLASSES.completeAction}`}
          >
            完成任务
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-3 text-xs text-[var(--text-secondary)]">
          {message}
        </p>
      ) : null}
    </article>
  );
}

function UnassignedCard({
  order,
  selected,
  onSelect
}: {
  order: DriverOrderMarkerViewV2;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      id={`driver-item-${order.orderId}`}
      type="button"
      onClick={onSelect}
      className={`min-h-11 w-full min-w-0 scroll-mt-4 rounded-2xl border bg-[var(--surface)] p-4 text-left shadow-sm ${
        selected
          ? "border-[var(--warning)] ring-2 ring-[color-mix(in_srgb,var(--warning)_32%,transparent)]"
          : "border-[var(--line)]"
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {visible(order.orderNo, "未分配任务")}
          </p>
          <p className="mt-1 break-words text-xs text-[var(--text-tertiary)]">
            {visible(
              order.pickupAddress ?? order.deliveryAddress,
              "地址待补充"
            )}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--warning)_17%,var(--surface))] px-2.5 py-1 text-xs font-medium text-[color-mix(in_srgb,var(--warning)_78%,var(--ink))]">
          仅查看
        </span>
      </div>
    </button>
  );
}

export function DriverWorkspace({
  driverId,
  driverName,
  amapKey,
  amapSecurityCode,
  initialData
}: {
  driverId: string;
  driverName: string;
  amapKey: string;
  amapSecurityCode: string;
  initialData?: DriverWorkspaceData;
}) {
  const [data, setData] = useState(initialData ?? EMPTY_WORKSPACE);
  const [activeView, setActiveView] = useState<"tasks" | "unassigned">("tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [endingShift, setEndingShift] = useState(false);
  const [shiftEnded, setShiftEnded] = useState(
    () =>
      initialData?.drivers.find((driver) => driver.id === driverId)?.onShift ===
      false
  );
  const [shiftMessage, setShiftMessage] = useState<string | null>(null);
  const [refreshGate] = useState(createLatestResponseGate);

  const refresh = useCallback(async () => {
    const requestId = refreshGate.beginRequest();
    try {
      const next = await fetchDriverWorkspace();
      refreshGate.commitIfLatest(requestId, () => {
        setData(next);
        setRefreshError(false);
      });
    } catch {
      refreshGate.commitIfLatest(requestId, () => setRefreshError(true));
    }
  }, [refreshGate]);

  useEffect(() => {
    if (!initialData) void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      DRIVER_READ_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [initialData, refresh]);

  const markers = useMemo<DriverMapMarker[]>(() => {
    const driverMarkers = data.drivers.flatMap((driver) =>
      driver.lastLocation
        ? [
            {
              id: `driver:${driver.id}`,
              kind: "driver" as const,
              label: visible(driver.name, "当班司机"),
              lat: driver.lastLocation.lat,
              lng: driver.lastLocation.lng,
              stale: driver.locationFreshness !== "FRESH"
            }
          ]
        : []
    );
    const taskMarkers = data.tasks.flatMap((task) => {
      const point = getTaskPoint(task);
      return point
        ? [
            {
              id: task.id,
              kind: "task" as const,
              label: visible(task.orderNo, "本人任务"),
              lat: point.lat,
              lng: point.lng
            }
          ]
        : [];
    });
    const unassignedMarkers = data.unassignedOrders.flatMap((order) => {
      const point = order.pickupPoint ?? order.deliveryPoint;
      return point
        ? [
            {
              id: order.orderId,
              kind: "unassigned" as const,
              label: visible(order.orderNo, "未分配任务"),
              lat: point.lat,
              lng: point.lng
            }
          ]
        : [];
    });
    return [...driverMarkers, ...taskMarkers, ...unassignedMarkers];
  }, [data]);

  const selectItem = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (data.tasks.some((task) => task.id === id)) setActiveView("tasks");
      if (data.unassignedOrders.some((order) => order.orderId === id)) {
        setActiveView("unassigned");
      }
    },
    [data.tasks, data.unassignedOrders]
  );

  useEffect(() => {
    if (!selectedId || selectedId.startsWith("driver:")) return;
    document.getElementById(`driver-item-${selectedId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, [activeView, selectedId]);

  const hasExecutingTask = data.tasks.some(
    (task) =>
      task.executionStatus === "EN_ROUTE" ||
      task.executionStatus === "IN_SERVICE"
  );
  const self = data.drivers.find((driver) => driver.id === driverId);
  const onShift = !shiftEnded && self?.onShift !== false;

  async function handleEndShift() {
    setEndingShift(true);
    setShiftMessage(null);
    try {
      await endDriverShift();
      setShiftEnded(true);
      setShiftMessage("已下班");
      await refresh();
    } catch {
      setShiftMessage("下班失败；执行中的任务必须先完成");
    } finally {
      setEndingShift(false);
    }
  }

  return (
    <div className="h-dvh min-h-0 min-w-0 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto min-w-0 max-w-[480px] px-3 pb-8 pt-3 sm:px-4">
        <header className="min-w-0 rounded-3xl bg-[var(--nav)] p-4 text-[var(--on-nav)] shadow-[var(--shadow-card)]">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--on-nav)] opacity-70">
                DRIVER OPS
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold">
                {visible(driverName, "司机工作台")}
              </h1>
            </div>
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--on-nav)_10%,transparent)] px-3 py-1.5 text-xs">
              {onShift ? "当班中" : "已下班"}
            </span>
          </div>
          <div className="mt-4 flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] p-3 text-[var(--ink)]">
            <DriverGpsTracker driverId={driverId} enabled={onShift} />
            <button
              type="button"
              disabled={endingShift || hasExecutingTask || !onShift}
              onClick={() => void handleEndShift()}
              className="min-h-11 shrink-0 rounded-xl border border-[var(--line)] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:bg-[var(--bg)] disabled:text-[var(--text-tertiary)]"
            >
              {endingShift ? "处理中" : onShift ? "下班" : "已下班"}
            </button>
          </div>
          {hasExecutingTask ? (
            <p className="mt-2 text-xs text-[var(--warning)]">
              执行中的任务完成前不能下班
            </p>
          ) : null}
          {shiftMessage ? (
            <p className="mt-2 text-xs text-[var(--on-nav)] opacity-75">
              {shiftMessage}
            </p>
          ) : null}
        </header>

        {refreshError ? (
          <div
            role="status"
            className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--warning)_17%,var(--surface))] px-3 py-2 text-xs text-[color-mix(in_srgb,var(--warning)_78%,var(--ink))]"
          >
            数据刷新失败，正在保留上次结果并自动重试
          </div>
        ) : null}

        <section className="mt-3 min-w-0 rounded-3xl bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">全局执行地图</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                15 秒更新 · 位置超过 120 秒即过期
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text-secondary)]">
              {data.drivers.length} 位当班
            </span>
          </div>
          <DriverMap
            markers={markers}
            selectedId={selectedId}
            amapKey={amapKey}
            amapSecurityCode={amapSecurityCode}
            onSelect={selectItem}
          />
          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs">
            {data.drivers.map((driver) => (
              <button
                key={driver.id}
                type="button"
                onClick={() => selectItem(`driver:${driver.id}`)}
                className="min-h-11 min-w-0 rounded-xl bg-[color-mix(in_srgb,var(--panel)_50%,var(--surface))] px-3 text-left"
              >
                <span className="block truncate font-medium text-[var(--text-primary)]">
                  {visible(driver.name, "当班司机")}
                </span>
                <span
                  className={
                    driver.locationFreshness === "FRESH"
                      ? "text-[var(--success)]"
                      : "text-[var(--danger)]"
                  }
                >
                  {driver.locationFreshness === "FRESH"
                    ? "位置新鲜"
                    : driver.locationFreshness === "STALE"
                      ? "位置已过期"
                      : "暂无位置"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 rounded-2xl bg-[var(--surface)] p-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveView("tasks")}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${
              activeView === "tasks"
                ? "bg-[var(--nav)] text-[var(--on-nav)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            我的 A/B/C（{data.tasks.length}）
          </button>
          <button
            type="button"
            onClick={() => setActiveView("unassigned")}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${
              activeView === "unassigned"
                ? DRIVER_ACCESSIBLE_COLOR_CLASSES.unassignedActive
                : "text-[var(--text-secondary)]"
            }`}
          >
            未分配订单（{data.unassignedOrders.length}）
          </button>
        </div>

        <main className="mt-3 min-w-0 space-y-3">
          {activeView === "tasks" ? (
            data.tasks.length > 0 ? (
              data.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  selected={selectedId === task.id}
                  onSelect={() => selectItem(task.id)}
                  onChanged={refresh}
                />
              ))
            ) : (
              <div className="rounded-2xl bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-tertiary)]">
                当前没有 A/B/C 任务
              </div>
            )
          ) : data.unassignedOrders.length > 0 ? (
            data.unassignedOrders.map((order) => (
              <UnassignedCard
                key={order.orderId}
                order={order}
                selected={selectedId === order.orderId}
                onSelect={() => selectItem(order.orderId)}
              />
            ))
          ) : (
            <div className="rounded-2xl bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-tertiary)]">
              当前没有允许显示的未分配订单
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

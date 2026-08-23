"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { DriverPlanV2, DriverV2, OrderV2 } from "@/types/v2";

import {
  DispatcherConsoleDialog,
  dialogTitle,
  resolveOperationReason,
  type DialogKind,
  type DialogState
} from "./dispatcher-console-dialog";
import {
  DispatcherConsoleMap,
  type DispatcherMapSelection
} from "./dispatcher-console-map";
import {
  DISPATCHER_V2_NAVIGATION,
  filterDriversByKeyword,
  filterVisibleOrders,
  isLatestSnapshotRequest,
  ORDER_BUSINESS_META,
  orderMatchesKeyword,
  resolveAssignedDriverId,
  sortOrdersForDispatchList
} from "./dispatcher-console-model";
import {
  apiErrorMessage,
  feasibilityMeta,
  formatTime,
  freshnessMeta,
  locationAge,
  requestV2,
  toInputTime,
  type MapSnapshotData,
  type OrderDetailData
} from "./dispatcher-console-support";
import { DispatcherConsoleTimeline } from "./dispatcher-console-timeline";
import styles from "./dispatcher-console.module.css";

type ConsoleEntry = "map" | "orders";
type OrderFilter = "ALL" | "UNASSIGNED" | "RISK";
type PanelMode = "ORDERS" | "DRIVERS";

const EMPTY_ORDERS: readonly OrderV2[] = [];
const EMPTY_DRIVERS: readonly DriverV2[] = [];

export function DispatcherConsole({
  entry,
  amapKey,
  amapSecurityCode
}: {
  entry: ConsoleEntry;
  amapKey: string;
  amapSecurityCode?: string;
}) {
  const [snapshot, setSnapshot] = useState<MapSnapshotData | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [mapSelection, setMapSelection] =
    useState<DispatcherMapSelection | null>(null);
  const [driverPlan, setDriverPlan] = useState<DriverPlanV2 | null>(null);
  const [timelineDetails, setTimelineDetails] = useState<
    Partial<Record<"A" | "B" | "C", OrderDetailData>>
  >({});
  const [selectedOrderDetail, setSelectedOrderDetail] =
    useState<OrderDetailData | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>(
    entry === "orders" ? "UNASSIGNED" : "ALL"
  );
  const [panelMode, setPanelMode] = useState<PanelMode>("ORDERS");
  const [keyword, setKeyword] = useState("");
  const [driverKeyword, setDriverKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
  const deferredDriverKeyword = useDeferredValue(driverKeyword);
  const [loading, setLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const latestSnapshotRequestIdRef = useRef(0);

  const loadSnapshot = useCallback(async (showLoading = false) => {
    const requestId = ++latestSnapshotRequestIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const next = await requestV2<MapSnapshotData>("/api/v2/map/snapshot");
      if (
        !isLatestSnapshotRequest(requestId, latestSnapshotRequestIdRef.current)
      ) {
        return;
      }
      const visibleOrders = filterVisibleOrders(next.orders);
      const nextSnapshot = { ...next, orders: visibleOrders };
      setSnapshot(nextSnapshot);
      setSelectedDriverId((current) =>
        current && next.drivers.some((driver) => driver.id === current)
          ? current
          : (next.drivers.find(
              (driver) =>
                driver.availability === "AVAILABLE" &&
                driver.locationFreshness === "FRESH"
            )?.id ??
            next.drivers[0]?.id ??
            null)
      );
      setSelectedOrderId((current) =>
        current && visibleOrders.some((order) => order.id === current)
          ? current
          : (visibleOrders.find((order) => order.feasibility === "INFEASIBLE")
              ?.id ??
            visibleOrders.find(
              (order) => order.executionStatus === "UNASSIGNED"
            )?.id ??
            visibleOrders[0]?.id ??
            null)
      );
      setWorkspaceError(null);
      setRefreshedAt(Date.now());
      setRevision((current) => current + 1);
    } catch (error) {
      if (
        !isLatestSnapshotRequest(requestId, latestSnapshotRequestIdRef.current)
      ) {
        return;
      }
      setWorkspaceError(apiErrorMessage(error));
    } finally {
      if (
        isLatestSnapshotRequest(requestId, latestSnapshotRequestIdRef.current)
      ) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setNowMs(Date.now());
    void loadSnapshot(true);
    const refreshTimer = window.setInterval(() => void loadSnapshot(), 15_000);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      latestSnapshotRequestIdRef.current += 1;
    };
  }, [loadSnapshot]);

  const selectedDriverPlanVersion = snapshot?.drivers.find(
    (driver) => driver.id === selectedDriverId
  )?.planVersion;

  useEffect(() => {
    setDriverPlan(null);
    setTimelineDetails({});
  }, [selectedDriverId]);

  useEffect(() => {
    if (!selectedDriverId) {
      setDriverPlan(null);
      setTimelineDetails({});
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPlanLoading(true);
    void requestV2<DriverPlanV2>(
      `/api/v2/drivers/${encodeURIComponent(selectedDriverId)}/plan`,
      { signal: controller.signal }
    )
      .then(async (plan) => {
        const slots = (["A", "B", "C"] as const).filter(
          (slot) => plan.slots[slot]
        );
        const details = await Promise.all(
          slots.map(async (slot) => {
            const orderId = plan.slots[slot]!.orderId;
            const detail = await requestV2<OrderDetailData>(
              `/api/v2/orders/${encodeURIComponent(orderId)}`,
              { signal: controller.signal }
            );
            return [slot, detail] as const;
          })
        );
        if (!active) return;
        setDriverPlan(plan);
        setTimelineDetails(Object.fromEntries(details));
      })
      .catch((error: unknown) => {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setWorkspaceError(apiErrorMessage(error));
      })
      .finally(() => {
        if (active) setPlanLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision, selectedDriverId, selectedDriverPlanVersion]);

  useEffect(() => {
    setSelectedOrderDetail(null);
  }, [selectedOrderId]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrderDetail(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    void requestV2<OrderDetailData>(
      `/api/v2/orders/${encodeURIComponent(selectedOrderId)}`,
      { signal: controller.signal }
    )
      .then((detail) => {
        if (active) setSelectedOrderDetail(detail);
      })
      .catch((error: unknown) => {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setWorkspaceError(apiErrorMessage(error));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision, selectedOrderId]);

  const orders = snapshot?.orders ?? EMPTY_ORDERS;
  const drivers = snapshot?.drivers ?? EMPTY_DRIVERS;
  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? null;
  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ?? null;

  const { orderById, storeNameByCode } = useMemo(() => {
    const stores = new Map<string, string>();
    const indexedOrders = new Map<string, OrderV2>();
    for (const order of orders) {
      indexedOrders.set(order.id, order);
      if (order.storeName) stores.set(order.storeCode, order.storeName);
    }
    return { orderById: indexedOrders, storeNameByCode: stores };
  }, [orders]);

  const filteredDrivers = useMemo(
    () =>
      filterDriversByKeyword(drivers, deferredDriverKeyword, storeNameByCode),
    [deferredDriverKeyword, drivers, storeNameByCode]
  );

  const filteredOrders = useMemo(
    () =>
      sortOrdersForDispatchList(
        orders.filter((order) => {
          if (
            orderFilter === "UNASSIGNED" &&
            order.executionStatus !== "UNASSIGNED"
          ) {
            return false;
          }
          if (
            orderFilter === "RISK" &&
            order.feasibility !== "AT_RISK" &&
            order.feasibility !== "INFEASIBLE"
          ) {
            return false;
          }
          return orderMatchesKeyword(order, deferredKeyword);
        })
      ),
    [deferredKeyword, orderFilter, orders]
  );

  const eligibleDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          driver.onShift &&
          driver.availability === "AVAILABLE" &&
          driver.locationFreshness === "FRESH"
      ),
    [drivers]
  );

  const timelineRows = useMemo(() => {
    return (["A", "B", "C"] as const).map((slot) => {
      const summary = driverPlan?.slots[slot];
      const detail = timelineDetails[slot];
      const currentAssignment = detail?.currentAssignment;
      const assignment =
        currentAssignment?.id === summary?.id ? currentAssignment : undefined;
      const order = summary ? orderById.get(summary.orderId) : undefined;
      const businessType = summary
        ? (detail?.businessType ?? order?.businessType)
        : undefined;
      const licensePlateSnapshot = summary
        ? (detail?.licensePlateSnapshot ?? order?.licensePlateSnapshot)
        : undefined;
      return {
        slot,
        summary,
        businessType,
        detail,
        assignment,
        licensePlateSnapshot
      };
    });
  }, [driverPlan, orderById, timelineDetails]);

  const selectDriver = useCallback((driverId: string) => {
    setSelectedDriverId(driverId);
    setMapSelection({ kind: "driver", id: driverId });
  }, []);

  const selectOrder = useCallback(
    (orderId: string) => {
      setSelectedOrderId(orderId);
      setMapSelection({ kind: "order", id: orderId });
      const driverId = resolveAssignedDriverId(orderId, drivers);
      if (driverId) setSelectedDriverId(driverId);
    },
    [drivers]
  );

  function openDialog(kind: DialogKind) {
    if (!selectedOrder || selectedOrderDetail?.id !== selectedOrder.id) return;
    const assignedDriverId = selectedOrderDetail?.currentAssignment?.driverId;
    const target =
      eligibleDrivers.find((driver) => driver.id !== assignedDriverId)?.id ??
      "";
    const selectedEligibleDriver = eligibleDrivers.find(
      (driver) => driver.id === selectedDriver?.id
    );
    setDialog({
      kind,
      targetDriverId:
        kind === "ASSIGN" ? (selectedEligibleDriver?.id ?? target) : target,
      reason: "",
      promisedPickupAt: toInputTime(selectedOrder.promisedPickupAt),
      pickupAddress: selectedOrder.pickupAddress,
      deliveryAddress: selectedOrder.deliveryAddress
    });
    setDialogError(null);
  }

  async function submitDialog() {
    if (!dialog || !selectedOrder || !selectedOrderDetail) return;
    const reason = resolveOperationReason(dialog.kind, dialog.reason);
    setSubmitting(true);
    setDialogError(null);
    try {
      const assignment = selectedOrderDetail.currentAssignment;
      if (dialog.kind === "ASSIGN") {
        const target = drivers.find(
          (driver) => driver.id === dialog.targetDriverId
        );
        if (!target) throw new Error("请选择目标司机");
        await requestV2("/api/v2/assignments", {
          method: "POST",
          body: JSON.stringify({
            orderId: selectedOrder.id,
            driverId: target.id,
            reason,
            expectedPlanVersion: target.planVersion
          })
        });
      } else if (dialog.kind === "REASSIGN") {
        if (!assignment) throw new Error("当前订单没有可改派的计划");
        const source = drivers.find(
          (driver) => driver.id === assignment.driverId
        );
        const target = drivers.find(
          (driver) => driver.id === dialog.targetDriverId
        );
        if (!source || !target)
          throw new Error("原司机或目标司机已离开当前快照");
        await requestV2(
          `/api/v2/assignments/${encodeURIComponent(assignment.id)}/reassign`,
          {
            method: "POST",
            body: JSON.stringify({
              toDriverId: target.id,
              reason,
              expectedFromPlanVersion: source.planVersion,
              expectedToPlanVersion: target.planVersion
            })
          }
        );
      } else if (dialog.kind === "WITHDRAW" || dialog.kind === "UNLOCK") {
        if (!assignment) throw new Error("当前订单没有可编辑的计划");
        const source = drivers.find(
          (driver) => driver.id === assignment.driverId
        );
        if (!source) throw new Error("司机已离开当前快照，请刷新后重试");
        const action = dialog.kind === "WITHDRAW" ? "withdraw" : "unlock";
        await requestV2(
          `/api/v2/assignments/${encodeURIComponent(assignment.id)}/${action}`,
          {
            method: "POST",
            body: JSON.stringify({
              reason,
              expectedPlanVersion: source.planVersion
            })
          }
        );
      } else {
        const body: Record<string, string> = { reason };
        const originalInput = toInputTime(selectedOrder.promisedPickupAt);
        if (dialog.promisedPickupAt !== originalInput) {
          if (!dialog.promisedPickupAt) {
            throw new Error(
              `请填写${ORDER_BUSINESS_META[selectedOrder.businessType].timeLabel}`
            );
          }
          body.promisedPickupAt = new Date(
            `${dialog.promisedPickupAt}:00+08:00`
          ).toISOString();
        }
        if (dialog.pickupAddress.trim() !== selectedOrder.pickupAddress) {
          body.pickupAddress = dialog.pickupAddress.trim();
        }
        if (dialog.deliveryAddress.trim() !== selectedOrder.deliveryAddress) {
          body.deliveryAddress = dialog.deliveryAddress.trim();
        }
        if (Object.keys(body).length === 1) {
          throw new Error("订单资料没有发生变化");
        }
        await requestV2(
          `/api/v2/orders/${encodeURIComponent(selectedOrder.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify(body)
          }
        );
      }
      const successLabel = dialogTitle(dialog.kind);
      setDialog(null);
      setToast(`${successLabel}已提交，正在刷新计划。`);
      window.setTimeout(() => setToast(null), 4_000);
      await loadSnapshot();
    } catch (error) {
      setDialogError(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const detailReady = selectedOrderDetail?.id === selectedOrder?.id;
  const assignment =
    selectedOrderDetail && selectedOrderDetail.id === selectedOrder?.id
      ? selectedOrderDetail.currentAssignment
      : undefined;
  const canReassign =
    Boolean(assignment) &&
    (selectedOrder?.executionStatus === "PLANNED" ||
      selectedOrder?.executionStatus === "EN_ROUTE");
  const canWithdraw =
    Boolean(assignment) && selectedOrder?.executionStatus === "PLANNED";
  const canUnlock =
    assignment?.lockType === "MANUAL_LOCKED" &&
    selectedOrder?.executionStatus === "PLANNED";
  const canEdit =
    selectedOrder?.executionStatus !== "COMPLETED" &&
    selectedOrder?.executionStatus !== "CANCELLED";

  return (
    <section className={styles.viewport}>
      <div className={styles.shell}>
        <nav className={styles.navRail} aria-label="V2 调度导航">
          <div className={styles.railBrand}>RCD</div>
          {DISPATCHER_V2_NAVIGATION.map((item) => {
            const active = item.entry === entry;
            return (
              <Link
                key={item.entry}
                href={item.href}
                className={active ? styles.railItemActive : styles.railItem}
                title={item.title}
                aria-label={item.title}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          <span className={styles.railSpacer} />
          <Link
            href="/admin/map"
            className={styles.railLegacy}
            title="返回 V1 调度地图"
            aria-label="返回 V1 调度地图"
          >
            V1
          </Link>
        </nav>

        <aside className={styles.workPanel}>
          <header className={styles.panelHeader}>
            <div className={styles.eyebrowRow}>
              <span>V2 · 滚动调度</span>
              <span className={styles.liveState}>
                ● 实时
              </span>
            </div>
            <h1>调度员工作台</h1>
            <p>订单、司机和 A/B/C 计划保持同屏，选择任一对象即可联动。</p>

            <div className={styles.kpiGrid}>
              <div>
                <span>当班司机</span>
                <strong>{drivers.length}</strong>
              </div>
              <div>
                <span>未分配</span>
                <strong>
                  {
                    orders.filter(
                      (order) => order.executionStatus === "UNASSIGNED"
                    ).length
                  }
                </strong>
              </div>
              <div
                className={
                  snapshot?.openAlertCount ? styles.kpiDanger : undefined
                }
              >
                <span>开放预警</span>
                <strong>{snapshot?.openAlertCount ?? 0}</strong>
              </div>
            </div>

            <div
              className={styles.entityTabs}
              role="tablist"
              aria-label="调度对象"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panelMode === "ORDERS"}
                aria-controls="dispatcher-order-panel"
                className={
                  panelMode === "ORDERS"
                    ? styles.entityTabActive
                    : styles.entityTab
                }
                onClick={() => setPanelMode("ORDERS")}
              >
                订单 <span>{orders.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelMode === "DRIVERS"}
                aria-controls="dispatcher-driver-panel"
                className={
                  panelMode === "DRIVERS"
                    ? styles.entityTabActive
                    : styles.entityTab
                }
                onClick={() => setPanelMode("DRIVERS")}
              >
                司机 <span>{drivers.length}</span>
              </button>
            </div>

            <label className={styles.searchBox}>
              <span>⌕</span>
              <input
                value={panelMode === "ORDERS" ? keyword : driverKeyword}
                onChange={(event) =>
                  panelMode === "ORDERS"
                    ? setKeyword(event.target.value)
                    : setDriverKeyword(event.target.value)
                }
                placeholder={
                  panelMode === "ORDERS"
                    ? "搜索订单、类型或取还车时间"
                    : "搜索司机、门店或门店编码"
                }
                aria-label={
                  panelMode === "ORDERS"
                    ? "搜索订单号、地址、类型或取还车时间"
                    : "搜索司机"
                }
              />
            </label>
            {panelMode === "ORDERS" ? (
              <div className={styles.filterTabs}>
                {(
                  [
                    ["ALL", "全部"],
                    ["UNASSIGNED", "未分配"],
                    ["RISK", "风险"]
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={
                      orderFilter === value
                        ? styles.filterActive
                        : styles.filter
                    }
                    onClick={() => setOrderFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.driverSearchHint}>
                按姓名或所属门店筛选，选择后同步地图与 12 小时计划。
              </p>
            )}
          </header>

          <div className={styles.orderListHeader}>
            <strong>{panelMode === "ORDERS" ? "订单池" : "司机目录"}</strong>
            <span>
              {panelMode === "ORDERS"
                ? `${filteredOrders.length} 条可见`
                : `${filteredDrivers.length} 名可见`}
            </span>
          </div>
          {panelMode === "ORDERS" ? (
            <div
              id="dispatcher-order-panel"
              className={styles.orderList}
              role="tabpanel"
            >
              {filteredOrders.map((order) => {
                const feasibility = feasibilityMeta[order.feasibility];
                const business = ORDER_BUSINESS_META[order.businessType];
                return (
                  <button
                    type="button"
                    key={order.id}
                    className={
                      order.id === selectedOrderId
                        ? styles.orderRowActive
                        : styles.orderRow
                    }
                    onClick={() => selectOrder(order.id)}
                  >
                    <span className={styles.orderRowTop}>
                      <span className={styles.orderIdentity}>
                        <b>{order.orderNo}</b>
                        <small>
                          {order.licensePlateSnapshot ?? "车牌待绑定"}
                        </small>
                      </span>
                      <em className={styles[`feasibility${order.feasibility}`]}>
                        {feasibility.icon} {feasibility.label}
                      </em>
                    </span>
                    <span className={styles.orderRoute}>
                      <small
                        className={`${styles.orderBusinessType} ${
                          styles[
                            `orderBusinessType${business.visualKind}`
                          ]
                        }`}
                      >
                        {business.label}
                      </small>
                      <span className={styles.orderRouteText}>
                        {business.visualKind === "PICKUP"
                          ? "送车地址"
                          : "还车地址"}
                        · {order.deliveryAddress}
                      </span>
                    </span>
                    <span className={styles.orderMeta}>
                      <small>
                        姓名待接入
                      </small>
                      <small>
                        {formatTime(order.promisedPickupAt)}{" "}
                        {business.timeLabel}
                      </small>
                      <small>{order.storeName ?? order.storeCode}</small>
                    </span>
                  </button>
                );
              })}
              {!loading && filteredOrders.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>没有符合条件的订单</strong>
                  <span>可切换筛选或清空关键词。</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              id="dispatcher-driver-panel"
              className={styles.driverList}
              role="tabpanel"
              aria-label="司机搜索结果"
            >
              {filteredDrivers.map((driver) => {
                const fresh = freshnessMeta[driver.locationFreshness];
                const occupiedSlots = Object.values(driver.slots).filter(
                  Boolean
                ).length;
                const storeName = storeNameByCode.get(driver.storeCode);
                return (
                  <button
                    type="button"
                    key={driver.id}
                    className={
                      driver.id === selectedDriverId
                        ? styles.driverRowActive
                        : styles.driverRow
                    }
                    onClick={() => selectDriver(driver.id)}
                    aria-pressed={driver.id === selectedDriverId}
                  >
                    <span className={styles.driverRowAvatar}>
                      {driver.name.slice(0, 1)}
                    </span>
                    <span className={styles.driverRowIdentity}>
                      <b>{driver.name}</b>
                      <small>
                        {storeName ?? driver.storeCode}
                        {storeName ? ` · ${driver.storeCode}` : ""}
                      </small>
                    </span>
                    <span className={styles.driverRowMeta}>
                      <b>{driver.onShift ? fresh.label : "未当班"}</b>
                      <small>
                        槽位 {occupiedSlots}/3 · v{driver.planVersion}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!loading && filteredDrivers.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>没有符合条件的司机</strong>
                  <span>可清空姓名、门店或门店编码关键词。</span>
                </div>
              ) : null}
            </div>
          )}
        </aside>

        <main className={styles.mainWorkspace}>
          <header className={styles.workspaceHeader}>
            <div>
              <span className={styles.headerKicker}>选中司机 · A/B/C 计划</span>
              <h2>{selectedDriver?.name ?? "请选择司机"}</h2>
            </div>
            {selectedDriver ? (
              <div
                className={`${styles.freshnessBadge} ${
                  styles[`freshness${selectedDriver.locationFreshness}`]
                }`}
              >
                <span>
                  {freshnessMeta[selectedDriver.locationFreshness].icon}
                </span>
                <div>
                  <strong>
                    {freshnessMeta[selectedDriver.locationFreshness].label}
                  </strong>
                  <small>
                    {locationAge(
                      selectedDriver.lastLocation?.capturedAt,
                      nowMs
                    )}
                  </small>
                </div>
              </div>
            ) : null}
            <div className={styles.headerMeta}>
              <span>计划版本</span>
              <strong>v{selectedDriver?.planVersion ?? "—"}</strong>
            </div>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void loadSnapshot(true)}
              disabled={loading}
            >
              ↻ {loading ? "刷新中" : "刷新"}
            </button>
          </header>

          <div className={styles.mapSection}>
            <DispatcherConsoleMap
              amapKey={amapKey}
              amapSecurityCode={amapSecurityCode}
              drivers={drivers}
              orders={orders}
              selection={mapSelection}
              onSelectDriver={selectDriver}
              onSelectOrder={selectOrder}
            />
            <div className={styles.mapLegend}>
              <span>
                <i className={styles.legendDriver} />
                司机
              </span>
              <span>
                <i className={styles.legendOrder} />
                订单
              </span>
              <span>
                <i className={styles.legendRisk} />
                不可行
              </span>
              <small>
                {refreshedAt
                  ? `${formatTime(new Date(refreshedAt).toISOString())} 刷新`
                  : "等待快照"}
              </small>
            </div>

            {selectedOrder ? (
              <article className={styles.orderDock}>
                <div className={styles.orderDockTitle}>
                  <span className={styles.dockIndex}>单</span>
                  <div>
                    <small>当前订单</small>
                    <strong>{selectedOrder.orderNo}</strong>
                  </div>
                  <em
                    className={
                      styles[`feasibility${selectedOrder.feasibility}`]
                    }
                  >
                    {feasibilityMeta[selectedOrder.feasibility].icon}{" "}
                    {feasibilityMeta[selectedOrder.feasibility].label}
                  </em>
                </div>
                <div className={styles.orderDockRoute}>
                  <span>
                    {ORDER_BUSINESS_META[selectedOrder.businessType]
                      .visualKind === "PICKUP"
                      ? "送车地址"
                      : "还车地址"}
                    · {selectedOrder.deliveryAddress}
                  </span>
                </div>
                <div className={styles.orderDockMeta}>
                  <span>
                    {ORDER_BUSINESS_META[selectedOrder.businessType].timeLabel}{" "}
                    <b>{formatTime(selectedOrder.promisedPickupAt)}</b>
                  </span>
                  <span>
                    余量 <b>{selectedOrder.slackMinutes ?? "—"} 分钟</b>
                  </span>
                  <span>
                    {assignment?.lockType === "MANUAL_LOCKED"
                      ? "🔒 人工锁定"
                      : assignment?.lockType === "AUTO_FROZEN"
                        ? "◆ 自动冻结"
                        : "◇ 未锁定"}
                  </span>
                </div>
                <div className={styles.orderActions}>
                  {selectedOrder.executionStatus === "UNASSIGNED" ? (
                    <button
                      type="button"
                      onClick={() => openDialog("ASSIGN")}
                      disabled={!detailReady}
                    >
                      人工分配
                    </button>
                  ) : null}
                  {canReassign ? (
                    <button
                      type="button"
                      onClick={() => openDialog("REASSIGN")}
                      disabled={!detailReady}
                    >
                      改派
                    </button>
                  ) : null}
                  {canWithdraw ? (
                    <button
                      type="button"
                      onClick={() => openDialog("WITHDRAW")}
                      disabled={!detailReady}
                    >
                      撤回
                    </button>
                  ) : null}
                  {canUnlock ? (
                    <button
                      type="button"
                      onClick={() => openDialog("UNLOCK")}
                      disabled={!detailReady}
                    >
                      解锁
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => openDialog("EDIT")}
                      disabled={!detailReady}
                    >
                      修改资料
                    </button>
                  ) : null}
                </div>
              </article>
            ) : null}
          </div>

          <DispatcherConsoleTimeline
            driverName={selectedDriver?.name}
            loading={planLoading}
            nowMs={nowMs}
            rows={timelineRows}
            onSelectOrder={selectOrder}
          />
        </main>
      </div>

      {workspaceError ? (
        <div className={styles.errorBanner} role="alert">
          <strong>数据同步失败</strong>
          <span>{workspaceError}</span>
          <button type="button" onClick={() => void loadSnapshot(true)}>
            重试
          </button>
        </div>
      ) : null}
      {toast ? (
        <div className={styles.toast} role="status">
          ✓ {toast}
        </div>
      ) : null}

      {dialog && selectedOrder ? (
        <DispatcherConsoleDialog
          dialog={dialog}
          orderNo={selectedOrder.orderNo}
          businessType={selectedOrder.businessType}
          currentDriverId={selectedOrderDetail?.currentAssignment?.driverId}
          eligibleDrivers={eligibleDrivers}
          error={dialogError}
          submitting={submitting}
          onChange={setDialog}
          onClose={() => setDialog(null)}
          onSubmit={() => void submitDialog()}
        />
      ) : null}
    </section>
  );
}

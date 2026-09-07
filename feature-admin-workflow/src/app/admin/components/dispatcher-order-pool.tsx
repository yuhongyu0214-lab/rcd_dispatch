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

import type { OrderV2 } from "@/types/v2";

import {
  DISPATCHER_V2_NAVIGATION,
  filterVisibleOrders,
  isCurrentAssignmentDetail,
  isLatestSnapshotRequest,
  ORDER_BUSINESS_META,
  orderMatchesKeyword,
  resolveOrderPromiseTimes,
  shouldFetchOrderDetail,
  sortOrdersForDispatchList
} from "./dispatcher-console-model";
import {
  apiErrorMessage,
  feasibilityMeta,
  formatTime,
  orderStatusMeta,
  requestV2,
  type MapSnapshotData,
  type OrderDetailData
} from "./dispatcher-console-support";
import styles from "./dispatcher-console.module.css";

type OrderPoolFilter = "ALL" | "UNASSIGNED" | "PLANNED" | "RISK";

const EMPTY_ORDERS: readonly OrderV2[] = [];

type OrderDetailCacheEntry = {
  assignmentId: string;
  detail: OrderDetailData;
};

export function DispatcherOrderPool() {
  const [snapshot, setSnapshot] = useState<MapSnapshotData | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detailsByOrderId, setDetailsByOrderId] = useState<
    Record<string, OrderDetailCacheEntry>
  >({});
  const detailsByOrderIdRef = useRef(detailsByOrderId);
  const [filter, setFilter] = useState<OrderPoolFilter>("ALL");
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const latestRequestIdRef = useRef(0);

  const cacheOrderDetail = useCallback(
    (orderId: string, entry: OrderDetailCacheEntry) => {
      setDetailsByOrderId((current) => {
        const next = { ...current, [orderId]: entry };
        detailsByOrderIdRef.current = next;
        return next;
      });
    },
    []
  );

  const loadSnapshot = useCallback(async (showLoading = false) => {
    const requestId = ++latestRequestIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const next = await requestV2<MapSnapshotData>("/api/v2/map/snapshot");
      if (!isLatestSnapshotRequest(requestId, latestRequestIdRef.current))
        return;
      const visibleOrders = filterVisibleOrders(next.orders);
      setSnapshot({ ...next, orders: visibleOrders });
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
      setError(null);
      setRefreshedAt(Date.now());
    } catch (caught) {
      if (!isLatestSnapshotRequest(requestId, latestRequestIdRef.current))
        return;
      setError(apiErrorMessage(caught));
    } finally {
      if (isLatestSnapshotRequest(requestId, latestRequestIdRef.current)) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(true);
    const timer = window.setInterval(() => void loadSnapshot(), 15_000);
    return () => {
      window.clearInterval(timer);
      latestRequestIdRef.current += 1;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const assignedOrders =
      snapshot?.orders.filter((order) => order.currentAssignmentId) ?? [];
    if (assignedOrders.length === 0) return;
    const controller = new AbortController();
    let active = true;
    for (const order of assignedOrders) {
      const assignmentId = order.currentAssignmentId;
      if (!assignmentId) continue;
      if (
        !shouldFetchOrderDetail(
          assignmentId,
          detailsByOrderIdRef.current[order.id]?.assignmentId
        )
      ) {
        continue;
      }
      void requestV2<OrderDetailData>(
        `/api/v2/orders/${encodeURIComponent(order.id)}`,
        { signal: controller.signal }
      )
        .then((detail) => {
          if (!active || !isCurrentAssignmentDetail(order, detail)) return;
          cacheOrderDetail(order.id, {
            assignmentId,
            detail
          });
        })
        .catch((caught: unknown) => {
          if (
            !active ||
            (caught instanceof DOMException && caught.name === "AbortError")
          ) {
            return;
          }
          // 失败详情不进入缓存；下一轮快照会按同一 assignmentId 重试。
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [cacheOrderDetail, snapshot?.orders]);

  const orders = snapshot?.orders ?? EMPTY_ORDERS;
  const driverById = useMemo(
    () =>
      new Map((snapshot?.drivers ?? []).map((driver) => [driver.id, driver])),
    [snapshot?.drivers]
  );

  const filteredOrders = useMemo(
    () =>
      sortOrdersForDispatchList(
        orders.filter((order) => {
          if (
            filter === "UNASSIGNED" &&
            order.executionStatus !== "UNASSIGNED"
          ) {
            return false;
          }
          if (
            filter === "PLANNED" &&
            order.executionStatus !== "PLANNED" &&
            order.executionStatus !== "EN_ROUTE" &&
            order.executionStatus !== "IN_SERVICE"
          ) {
            return false;
          }
          if (
            filter === "RISK" &&
            order.feasibility !== "AT_RISK" &&
            order.feasibility !== "INFEASIBLE"
          ) {
            return false;
          }
          return orderMatchesKeyword(order, deferredKeyword);
        })
      ),
    [deferredKeyword, filter, orders]
  );

  const counts = useMemo(
    () => ({
      all: orders.length,
      unassigned: orders.filter(
        (order) => order.executionStatus === "UNASSIGNED"
      ).length,
      planned: orders.filter((order) =>
        ["PLANNED", "EN_ROUTE", "IN_SERVICE"].includes(order.executionStatus)
      ).length,
      risk: orders.filter(
        (order) =>
          order.feasibility === "AT_RISK" || order.feasibility === "INFEASIBLE"
      ).length
    }),
    [orders]
  );

  return (
    <section className={styles.viewport}>
      <div className={styles.orderPoolShell}>
        <nav className={styles.navRail} aria-label="V2 调度导航">
          <div className={styles.railBrand}>RCD</div>
          {DISPATCHER_V2_NAVIGATION.map((item) => {
            const active = item.entry === "orders";
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

        <main className={styles.orderPoolWorkspace}>
          <header className={styles.orderPoolHeader}>
            <div>
              <span className={styles.headerKicker}>
                V2 · 调度订单池
              </span>
              <h1>订单列表</h1>
              <p>单卡集中核对行程、车辆、工单状态和空驶 ETA。</p>
            </div>
            <div className={styles.orderPoolMetrics} aria-label="订单统计">
              <div>
                <span>全部</span>
                <strong>{counts.all}</strong>
              </div>
              <div>
                <span>未分配</span>
                <strong>{counts.unassigned}</strong>
              </div>
              <div>
                <span>执行计划</span>
                <strong>{counts.planned}</strong>
              </div>
              <div
                className={
                  counts.risk ? styles.orderPoolMetricDanger : undefined
                }
              >
                <span>风险</span>
                <strong>{counts.risk}</strong>
              </div>
            </div>
            <div className={styles.orderPoolRefresh}>
              <span>
                {refreshedAt
                  ? `${formatTime(new Date(refreshedAt).toISOString())} 已更新`
                  : "等待订单快照"}
              </span>
              <button
                type="button"
                className={styles.refreshButton}
                onClick={() => void loadSnapshot(true)}
                disabled={loading}
              >
                ↻ {loading ? "刷新中" : "刷新"}
              </button>
            </div>
          </header>

          <div className={styles.orderPoolContent}>
            <section
              className={styles.orderPoolListPanel}
              aria-label="订单池列表"
            >
              <div className={styles.orderPoolToolbar}>
                <label className={styles.orderPoolSearch}>
                  <span>⌕</span>
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索订单、类型或取还车时间"
                    aria-label="搜索订单号、地址、类型或取还车时间"
                  />
                </label>
                <div className={styles.orderPoolFilters} aria-label="订单筛选">
                  {(
                    [
                      ["ALL", "全部", counts.all],
                      ["UNASSIGNED", "未分配", counts.unassigned],
                      ["PLANNED", "执行计划", counts.planned],
                      ["RISK", "风险", counts.risk]
                    ] as const
                  ).map(([value, label, count]) => (
                    <button
                      type="button"
                      key={value}
                      className={
                        filter === value ? styles.filterActive : styles.filter
                      }
                      onClick={() => setFilter(value)}
                    >
                      {label} <span>{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.orderPoolListCaption}>
                <strong>订单池</strong>
                <span>
                  {filteredOrders.length} 条结果 · 支持鼠标滚轮或上下方向键浏览
                </span>
              </div>
              <div
                className={styles.orderPoolScrollable}
                role="region"
                tabIndex={0}
                aria-label="订单列表，可上下滚动"
              >
                {filteredOrders.map((order) => {
                  const status = orderStatusMeta[order.executionStatus];
                  const feasibility = feasibilityMeta[order.feasibility];
                  const business = ORDER_BUSINESS_META[order.businessType];
                  const promiseTimes = resolveOrderPromiseTimes(order);
                  const cacheEntry = detailsByOrderId[order.id];
                  const detail =
                    order.currentAssignmentId &&
                    cacheEntry?.assignmentId === order.currentAssignmentId
                      ? cacheEntry.detail
                      : undefined;
                  const assignment = isCurrentAssignmentDetail(order, detail)
                    ? detail?.currentAssignment
                    : undefined;
                  const assignedDriver = assignment
                    ? driverById.get(assignment.driverId)
                    : undefined;
                  const assignmentLabel = !order.currentAssignmentId
                    ? "未分配"
                    : assignment
                      ? `${assignedDriver?.name ?? "司机未知"} · ${assignment.slot} 槽`
                      : detail === undefined
                        ? "已分配 · 同步中"
                        : "计划已变化";
                  const etaLabel = !order.currentAssignmentId
                    ? "未生成"
                    : assignment
                      ? assignment.etaAvailable
                        ? `${assignment.deadheadEtaMinutes ?? "—"} 分钟`
                        : "不可用"
                      : detail === undefined
                        ? "同步中"
                        : "待重算";
                  return (
                    <button
                      type="button"
                      key={order.id}
                      className={
                        order.id === selectedOrderId
                          ? styles.orderPoolRowActive
                          : styles.orderPoolRow
                      }
                      onClick={() => setSelectedOrderId(order.id)}
                      aria-pressed={order.id === selectedOrderId}
                    >
                      <span className={styles.orderPoolRowPrimary}>
                        <b>{order.orderNo}</b>
                        <span>
                          <small
                            className={`${styles.orderBusinessType} ${
                              styles[
                                `orderBusinessType${business.visualKind}`
                              ]
                            }`}
                          >
                            {business.label}
                          </small>
                          <em
                            className={
                              styles[`feasibility${order.feasibility}`]
                            }
                          >
                            {feasibility.icon} {feasibility.label}
                          </em>
                          <small>
                            {status.icon} {status.label}
                          </small>
                        </span>
                      </span>
                      <span className={styles.orderPoolRowRoute}>
                        <i>取</i>
                        <span>{order.pickupAddress}</span>
                        <b>→</b>
                        <i>送</i>
                        <span>{order.deliveryAddress}</span>
                      </span>
                      <span className={styles.orderPoolRowFacts}>
                        <span>
                          <small>取车时间</small>
                          <b>
                            {promiseTimes.pickupAt
                              ? formatTime(promiseTimes.pickupAt)
                              : "未提供"}
                          </b>
                        </span>
                        <span>
                          <small>还车时间</small>
                          <b>
                            {promiseTimes.returnAt
                              ? formatTime(promiseTimes.returnAt)
                              : "未提供"}
                          </b>
                        </span>
                        <span>
                          <small>所属门店</small>
                          <b>{order.storeName ?? order.storeCode}</b>
                        </span>
                        <span>
                          <small>车牌号</small>
                          <b>{order.licensePlateSnapshot ?? "暂未绑定"}</b>
                        </span>
                        <span>
                          <small>工单分配状态</small>
                          <b>{assignmentLabel}</b>
                        </span>
                        <span>
                          <small>空驶 ETA</small>
                          <b>{etaLabel}</b>
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!loading && filteredOrders.length === 0 ? (
                  <div className={styles.emptyState}>
                    <strong>没有符合条件的订单</strong>
                    <span>可切换筛选条件或清空搜索关键词。</span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </main>
      </div>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <strong>订单同步失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void loadSnapshot(true)}>
            重试
          </button>
        </div>
      ) : null}
    </section>
  );
}

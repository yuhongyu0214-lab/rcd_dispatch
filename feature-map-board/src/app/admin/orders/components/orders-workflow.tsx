"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type OrderItem = {
  id: string;
  orderNo: string;
  type: string;
  status: string;
  licensePlateSnapshot: string | null;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  driverNameSnapshot: string | null;
  store: {
    id: string;
    name: string;
    code: string;
  };
  vehicle: {
    id: string;
    licensePlate: string;
    vehicleType: string;
  } | null;
  currentAssignment: {
    id: string;
    driverId: string;
    driver: Driver;
  } | null;
};

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

type OrderDetailPayload = {
  order: OrderItem & {
    assignments: Array<{
      id: string;
      type: string;
      status: string;
      assignedAt: string;
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
  activeStoreOrders: number;
  activeDoorOrders: number;
  priorityRank: number;
  score: number;
  reason: string;
};

type DispatchResult = {
  orderId: string;
  orderNo: string;
  orderType: string;
  outcome: "DISPATCHED" | "PENDING" | "MANUAL";
  reason: "NO_DRIVER" | "ETA_EXCEEDED" | null;
  topN: RankedCandidate[];
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
  { value: "COMPLETED", label: "已完成" },
  { value: "RECYCLED", label: "已回收" },
  { value: "CANCELLED", label: "已取消" }
];

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

function readApiError<T>(payload: ApiResponse<T>) {
  return payload.success ? null : payload.error;
}

export function OrdersWorkflow() {
  const [ordersPayload, setOrdersPayload] = useState<OrdersPayload | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetailPayload | null>(null);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("ALL");
  const [pageSize, setPageSize] = useState(20);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [reason, setReason] = useState("");
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [message, setMessage] = useState("正在加载订单...");
  const [isBusy, setIsBusy] = useState(false);

  const selectedOrder = useMemo(() => {
    return (
      detail?.order ??
      ordersPayload?.items.find((order) => order.id === selectedOrderId) ??
      null
    );
  }, [detail?.order, ordersPayload?.items, selectedOrderId]);

  const drivers = ordersPayload?.drivers ?? [];
  const availableDrivers = drivers.filter(
    (driver) => driver.status !== "OFFLINE" && driver.status !== "UNAVAILABLE"
  );

  async function loadOrders(nextSelectedOrderId?: string | null) {
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(pageSize),
      status
    });

    if (keyword.trim()) {
      params.set("q", keyword.trim());
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
    setDispatchResult(null);
    setSelectedCandidateId("");
  }

  async function runRecommend(orderId: string) {
    setIsBusy(true);
    setMessage("推荐派单计算中...");

    try {
      const response = await fetch("/api/dispatch/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, topN: 3 })
      });
      const payload = (await response.json()) as ApiResponse<DispatchResult>;

      if (!payload.success) {
        setMessage(payload.error);
        return;
      }

      setDispatchResult(payload.data);
      setSelectedCandidateId(payload.data.topN[0]?.driverId ?? "");
      setMessage(
        payload.data.outcome === "DISPATCHED"
          ? `推荐完成，返回 ${payload.data.topN.length} 名候选司机`
          : `推荐完成：${payload.data.reason ?? payload.data.outcome}`
      );
      await loadOrders(orderId);
      await loadDetail(orderId);
    } finally {
      setIsBusy(false);
    }
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
      const payload = (await response.json()) as ApiResponse<unknown>;
      const error = readApiError(payload);

      if (error) {
        setMessage(error);
        return;
      }

      setMessage(`${label}成功`);
      await loadOrders(body.orderId ?? selectedOrderId);
      await loadDetail(body.orderId ?? selectedOrderId);
      setDispatchResult(null);
      setSelectedCandidateId("");
      setReason("");
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, pageSize]);

  useEffect(() => {
    void loadDetail(selectedOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

  return (
    <section className="grid h-screen min-w-[1488px] grid-cols-[72px_420px_minmax(996px,1fr)] overflow-hidden bg-[var(--bg)]">
      <nav className="flex flex-col items-center gap-3 bg-[var(--nav)] px-3 py-4 text-white">
        <Link
          href="/admin/map"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.08] text-xs font-bold"
          title="地图看板"
        >
          图
        </Link>
        <Link
          href="/admin/orders"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] bg-[var(--primary)] text-xs font-bold text-white"
          title="订单池"
        >
          单
        </Link>
        <Link
          href="/admin/orders"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.08] text-xs font-bold text-white/70"
          title="司机管理"
        >
          人
        </Link>
        <Link
          href="/admin/orders"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.08] text-xs font-bold text-white/70"
          title="车辆管理"
        >
          车
        </Link>
        <Link
          href="/admin/orders"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.08] text-xs font-bold text-white/70"
          title="预警中心"
        >
          警
        </Link>
        <Link
          href="/admin/orders"
          className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.08] text-xs font-bold text-white/70"
          title="日志查询"
        >
          日
        </Link>
      </nav>

      <aside className="flex min-w-0 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
        <div className="border-b border-black/10 p-5">
          <p className="text-xs font-semibold text-[var(--muted)]">
            订单池 · 自动传入
          </p>
          <h2 className="mt-2 text-2xl font-bold">订单池</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            外部订单入库后在此进入调度闭环。
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-[var(--kpi-h)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--muted)]">当前显示</p>
              <p className="text-lg font-bold">{ordersPayload?.items.length ?? 0}</p>
            </div>
            <div className="h-[var(--kpi-h)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--muted)]">订单总数</p>
              <p className="text-lg font-bold">{ordersPayload?.total ?? 0}</p>
            </div>
            <div className="h-[var(--kpi-h)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--muted)]">可调司机</p>
              <p className="text-lg font-bold">{availableDrivers.length}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_132px] gap-2">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索订单、车牌、地址、门店"
              className="h-[var(--control-h)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-[var(--control-h)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]"
            >
              {orderStatuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-3">
            {ordersPayload?.items.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrderId(order.id)}
                className={`rounded-lg border p-4 text-left transition ${
                  selectedOrderId === order.id
                    ? "border-[var(--primary)] bg-[var(--surface)] shadow-[var(--shadow-card)]"
                    : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--primary)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold">
                      {order.orderNo} · {order.licensePlateSnapshot ?? "未绑定车牌"}
                    </p>
                    <p className="mt-1 text-xs text-[#606a73]">
                      {getOrderTypeLabel(order.type)} · {formatDateTime(order.scheduledAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#eef3f2] px-2.5 py-1 text-xs font-bold text-[#1f3a35]">
                    {getStatusLabel(order.status)}
                  </span>
                </div>
                <p className="mt-3 truncate text-sm text-[#384552]">
                  {order.pickupAddress} → {order.returnAddress}
                </p>
                <p className="mt-2 text-xs text-[#66717a]">
                  门店 {order.store.name} · 当前司机{" "}
                  {order.currentAssignment?.driver.name ?? order.driverNameSnapshot ?? "未派单"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-14 items-center justify-between border-t border-[var(--line)] px-4 text-sm">
          <span className="text-[var(--muted)]">{message}</span>
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
          >
            <option value={20}>20 条</option>
            <option value={50}>50 条</option>
            <option value={100}>100 条</option>
          </select>
        </div>
      </aside>

      <div className="min-w-0 overflow-auto bg-[var(--bg)] p-4">
        {selectedOrder ? (
          <div className="grid min-w-[996px] grid-cols-[minmax(620px,1fr)_360px] gap-4">
            <section className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b6258]">
                    Order Detail
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{selectedOrder.orderNo}</h2>
                </div>
                <span className="rounded-full bg-[#eef3f2] px-3 py-1 text-sm font-bold">
                  {getStatusLabel(selectedOrder.status)}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["订单类型", getOrderTypeLabel(selectedOrder.type)],
                  ["用车时间", formatDateTime(selectedOrder.scheduledAt)],
                  ["当前门店", selectedOrder.store.name],
                  ["车牌号", selectedOrder.licensePlateSnapshot ?? "未绑定"],
                  ["当前司机", selectedOrder.currentAssignment?.driver.name ?? "未派单"],
                  ["司机状态", selectedOrder.currentAssignment?.driver.status ? getStatusLabel(selectedOrder.currentAssignment.driver.status) : "-"],
                  ["取车地址", selectedOrder.pickupAddress],
                  ["还车地址", selectedOrder.returnAddress]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-black/10 bg-[#f7f9f8] p-3">
                    <p className="text-xs text-[#66717a]">{label}</p>
                    <p className="mt-1 truncate text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-black/10 bg-[#fafafa] p-4">
                <h3 className="text-base font-bold">调度操作</h3>
                <div className="mt-3 grid grid-cols-[1fr_180px] gap-3">
                  <select
                    value={selectedDriverId}
                    onChange={(event) => setSelectedDriverId(event.target.value)}
                    className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#b36b21]"
                  >
                    <option value="">选择司机</option>
                    {availableDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name} · {getStatusLabel(driver.status)} · {driver.store?.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={
                      isBusy ||
                      !selectedDriverId ||
                      (selectedOrder.status !== "PENDING" &&
                        selectedOrder.status !== "RECOMMENDING")
                    }
                    onClick={() =>
                      runAction("派单", "/api/assignments", {
                        orderId: selectedOrder.id,
                        driverId: selectedDriverId
                      })
                    }
                    className="h-10 rounded-[var(--radius-sm)] bg-[var(--primary)] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#c8c1bc]"
                  >
                    手动派单
                  </button>
                </div>

                <div className="mt-3 rounded-lg border border-black/10 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold">推荐派单 Top N</h4>
                      <p className="mt-1 text-xs text-[#66717a]">
                        当前为规则引擎 ETA 占位，接高德后改为真实驾车时长。
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy || selectedOrder.status !== "PENDING"}
                      onClick={() => runRecommend(selectedOrder.id)}
                    className="h-9 rounded-[var(--radius-sm)] border border-[var(--success)] px-3 text-xs font-bold text-[var(--success)] disabled:cursor-not-allowed disabled:border-[#c8c1bc] disabled:text-[#a8a09a]"
                    >
                      运行推荐
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {dispatchResult?.topN.length ? (
                      dispatchResult.topN.map((candidate, index) => (
                        <label
                          key={candidate.driverId}
                          className={`grid cursor-pointer grid-cols-[24px_1fr] gap-2 rounded-lg border p-3 text-sm ${
                            selectedCandidateId === candidate.driverId
                              ? "border-[#2f6f62] bg-[#f1faf5]"
                              : "border-black/10 bg-[#fafafa]"
                          }`}
                        >
                          <input
                            type="radio"
                            checked={selectedCandidateId === candidate.driverId}
                            onChange={() => setSelectedCandidateId(candidate.driverId)}
                            className="mt-1"
                          />
                          <span>
                            <span className="flex items-center justify-between gap-3">
                              <strong>
                                #{index + 1} {candidate.driverName}
                              </strong>
                              <span className="text-xs text-[#66717a]">
                                ETA {candidate.etaMinutes}m
                              </span>
                            </span>
                            <span className="mt-1 grid grid-cols-3 gap-2 text-xs text-[#66717a]">
                              <span>状态 {getStatusLabel(candidate.driverStatus)}</span>
                              <span>负载 {candidate.activeStoreOrders}</span>
                              <span>惩罚 +{candidate.loadPenaltyMinutes}m</span>
                            </span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-black/20 p-3 text-xs text-[#66717a]">
                        暂无推荐结果。
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={
                      isBusy ||
                      !selectedCandidateId ||
                      (selectedOrder.status !== "PENDING" &&
                        selectedOrder.status !== "RECOMMENDING")
                    }
                    onClick={() =>
                      runAction("确认推荐派单", "/api/dispatch/confirm", {
                        orderId: selectedOrder.id,
                        driverId: selectedCandidateId
                      })
                    }
                    className="mt-3 h-10 w-full rounded-[var(--radius-sm)] bg-[var(--success)] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#c8c1bc]"
                  >
                    确认推荐司机
                  </button>
                </div>

                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="改派或撤回原因"
                  className="mt-3 h-20 w-full resize-none rounded-lg border border-black/10 bg-white p-3 text-sm outline-none focus:border-[#b36b21]"
                />

                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    disabled={
                      isBusy ||
                      !selectedDriverId ||
                      !reason.trim() ||
                      (selectedOrder.status !== "ASSIGNED" && selectedOrder.status !== "ACCEPTED")
                    }
                    onClick={() =>
                      runAction("改派", "/api/assignments/reassign", {
                        orderId: selectedOrder.id,
                        driverId: selectedDriverId,
                        reason
                      })
                    }
                    className="h-10 rounded-[var(--radius-sm)] border border-[var(--primary)] px-4 text-sm font-bold text-[var(--primary)] disabled:cursor-not-allowed disabled:border-[#c8c1bc] disabled:text-[#a8a09a]"
                  >
                    改派
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || selectedOrder.status !== "ASSIGNED"}
                    onClick={() =>
                      runAction("撤回", "/api/assignments/withdraw", {
                        orderId: selectedOrder.id,
                        reason
                      })
                    }
                    className="h-10 rounded-[var(--radius-sm)] border border-[var(--danger)] px-4 text-sm font-bold text-[var(--danger)] disabled:cursor-not-allowed disabled:border-[#c8c1bc] disabled:text-[#a8a09a]"
                  >
                    撤回
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
              <h3 className="text-base font-bold">操作日志</h3>
              <p className="mt-1 text-xs text-[#66717a]">按时间倒序展示当前订单操作记录。</p>
              <div className="mt-4 flex max-h-[580px] flex-col gap-3 overflow-y-auto">
                {detail?.logs.length ? (
                  detail.logs.map((log) => (
                    <article key={log.id} className="rounded-lg border border-black/10 bg-[#f7f9f8] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold">{log.action}</p>
                        <p className="text-xs text-[#66717a]">{formatDateTime(log.createdAt)}</p>
                      </div>
                      <p className="mt-2 text-xs text-[#66717a]">
                        操作人 {log.operatorUser.name} · {log.reason ?? "无原因"}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-black/20 p-5 text-sm text-[#66717a]">
                    暂无操作日志。
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-black/20 bg-white p-8 text-sm text-[#66717a]">
            暂无可展示订单。
          </div>
        )}
      </div>
    </section>
  );
}

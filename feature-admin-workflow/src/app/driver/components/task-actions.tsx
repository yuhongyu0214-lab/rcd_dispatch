"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// ============================================================================
// 类型
// ============================================================================

type TaskActionsProps = {
  orderId: string;
  orderStatus: string;
  driverId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  returnLat: number | null;
  returnLng: number | null;
};

// ============================================================================
// TaskActions
// ============================================================================

export function TaskActions({
  orderId,
  orderStatus,
  driverId,
  pickupLat,
  pickupLng,
  returnLat,
  returnLng
}: TaskActionsProps) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [completing, setCompleting] = useState(false);

  // ---- 接单 ----
  async function handleAccept() {
    setAccepting(true);
    try {
      const res = await fetch(`/api/driver/tasks/${orderId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driverId })
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = (await res.json()) as { error?: string };
        alert(body.error ?? "接单失败，请重试");
      }
    } catch {
      alert("网络异常，接单失败");
    } finally {
      setAccepting(false);
    }
  }

  // ---- 完单 ----
  async function handleComplete() {
    if (!confirm("确认完单？此操作不可撤销。")) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/driver/tasks/${orderId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driverId })
      });
      if (res.ok) {
        router.refresh();
        router.push("/driver/tasks");
      } else {
        const body = (await res.json()) as { error?: string };
        alert(body.error ?? "完单失败，请重试");
      }
    } catch {
      alert("网络异常，完单失败");
    } finally {
      setCompleting(false);
    }
  }

  // ---- 导航 ----
  function buildNavUri(lat: number | null, lng: number | null): string | null {
    if (lat == null || lng == null) return null;
    // 高德地图 URI scheme
    return `https://uri.amap.com/navigation?to=${lng},${lat}&mode=car&callnative=1`;
  }

  const pickupNav = buildNavUri(pickupLat, pickupLng);
  const returnNav = buildNavUri(returnLat, returnLng);

  // ---- 按钮渲染 ----
  const showAccept = orderStatus === "ASSIGNED";
  const showComplete =
    orderStatus === "ACCEPTED" || orderStatus === "IN_PROGRESS";
  const showNav = orderStatus === "ACCEPTED" || orderStatus === "IN_PROGRESS";

  if (orderStatus === "COMPLETED") {
    return (
      <div className="rounded-2xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-700">
        已完成 ✓
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 接单按钮 */}
      {showAccept ? (
        <button
          onClick={handleAccept}
          disabled={accepting}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-medium text-white transition active:bg-slate-700 disabled:opacity-50"
        >
          {accepting ? "处理中..." : "确认接单"}
        </button>
      ) : null}

      {/* 导航按钮 */}
      {showNav ? (
        <div className="flex gap-3">
          {pickupNav ? (
            <a
              href={pickupNav}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-sm font-medium text-white transition active:bg-blue-500"
            >
              🧭 导航前往取车
            </a>
          ) : (
            <button
              disabled
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-slate-200 text-sm text-slate-400"
            >
              取车坐标缺失
            </button>
          )}
          {returnNav ? (
            <a
              href={returnNav}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-medium text-white transition active:bg-emerald-500"
            >
              🧭 导航前往还车
            </a>
          ) : (
            <button
              disabled
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-slate-200 text-sm text-slate-400"
            >
              还车坐标缺失
            </button>
          )}
        </div>
      ) : null}

      {/* 完单按钮 */}
      {showComplete ? (
        <button
          onClick={handleComplete}
          disabled={completing}
          className="inline-flex h-12 items-center justify-center rounded-xl border-2 border-emerald-600 bg-white text-sm font-medium text-emerald-700 transition active:bg-emerald-50 disabled:opacity-50"
        >
          {completing ? "处理中..." : "✓ 确认完单"}
        </button>
      ) : null}
    </div>
  );
}

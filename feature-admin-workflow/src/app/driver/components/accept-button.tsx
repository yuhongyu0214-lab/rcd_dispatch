"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptButton({
  orderId,
  driverId
}: {
  orderId: string;
  driverId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleAccept(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);

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
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleAccept}
      disabled={loading}
      className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-medium text-white transition active:bg-slate-700 disabled:opacity-50"
    >
      {loading ? "处理中..." : "接单"}
    </button>
  );
}

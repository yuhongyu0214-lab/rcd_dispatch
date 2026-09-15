"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { ApiResponseV2 } from "@/types/v2";

export function DriverProfileSetup({
  stores,
  existingStoreId,
  blockedReason
}: {
  stores: { id: string; code: string; name: string }[];
  existingStoreId?: string;
  blockedReason?: string;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(existingStoreId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable =
    blockedReason ||
    (stores.length === 0 ? "暂无可用门店，请联系管理员建立门店。" : undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || unavailable) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v2/account/driver-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId })
      });
      const payload = (await response.json()) as ApiResponseV2<{
        driverId: string;
      }>;
      if (!payload.success) {
        setError(`${payload.error.message}（traceId: ${payload.traceId}）`);
        return;
      }
      router.refresh();
    } catch {
      setError("档案暂未保存成功，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--bg)] px-4 py-8 text-[var(--text-primary)]">
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-lg flex-col gap-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
      >
        <h1 className="text-xl font-semibold">司机工作台</h1>
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          你的账号已拥有双端权限。首次使用 H5
          需完善本人司机档案，之后无需重复设置。
          {existingStoreId
            ? "已找到同手机号档案，确认后关联，不改变原门店和工作状态。"
            : "请选择所属门店，新档案默认下班。"}
        </p>
        {unavailable ? (
          <p role="status" className="text-sm">
            {unavailable}
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-2 text-sm">
              <span>所属门店</span>
              <select
                required
                value={storeId}
                disabled={Boolean(existingStoreId)}
                onChange={(event) => setStoreId(event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3"
              >
                <option value="">请选择所属门店</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.code} — {store.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting || !storeId}
              className="min-h-11 rounded-lg bg-[var(--nav)] px-4 text-[var(--on-nav)] disabled:opacity-50"
            >
              {submitting ? "保存中…" : "完成档案并进入任务列表"}
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className="break-words text-sm">
            {error}
          </p>
        ) : null}
        <Link
          href="/admin/map/v2"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          打开调度工作台
        </Link>
      </form>
    </main>
  );
}

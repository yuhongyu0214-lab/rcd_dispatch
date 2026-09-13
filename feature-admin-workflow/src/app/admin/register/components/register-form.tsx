"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type RegisterResponse =
  | {
      success: true;
      data: {
        id: string;
        email: string;
        phone: string;
        name: string;
        role: string;
        driverId: string | null;
      };
      error: null;
      traceId: string;
    }
  | {
      success: false;
      data: null;
      error: string;
      traceId: string;
    };

type StoreOption = {
  id: string;
  code: string;
  name: string;
};

export function RegisterForm({ stores }: { stores: StoreOption[] }) {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [storeId, setStoreId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          account,
          name,
          password,
          storeId
        })
      });
      const payload = (await response.json()) as RegisterResponse;

      if (!payload.success) {
        setError(`${payload.error}（traceId: ${payload.traceId}）`);
        return;
      }

      router.replace("/admin/login?registered=1&next=%2Fadmin%2Fmap");
      router.refresh();
    } catch {
      setError("注册失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">账号注册</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          注册后同时拥有调度工作台和司机 H5 权限，无需单独开通。
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">手机号账号</span>
        <input
          type="tel"
          required
          autoComplete="tel"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">姓名</span>
        <input
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">密码</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      {stores.length > 0 ? (
        <label className="flex flex-col gap-2 text-sm text-slate-700">
          <span className="font-medium text-slate-900">所属门店</span>
          <select
            required
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900 bg-white"
          >
            <option value="">请选择所属门店</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {stores.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          暂无可用门店，请先由管理员建立门店。
        </div>
      ) : null}

      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>司机档案默认下班，不会自动参与派单。</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || stores.length === 0}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "注册中..." : "注册"}
      </button>
    </form>
  );
}

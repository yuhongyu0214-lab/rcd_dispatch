"use client";

import { FormEvent, useEffect, useState } from "react";
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

export function RegisterForm() {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [name, setName] = useState("运营管理员");
  const [password, setPassword] = useState("");
  const [alsoDriver, setAlsoDriver] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载门店列表（供"同时作为司机"选择所属门店）
  useEffect(() => {
    fetch("/api/stores")
      .then((r) => r.json())
      .then((p: { success: boolean; data?: { stores: StoreOption[] } }) => {
        if (p.success && p.data?.stores) {
          setStores(p.data.stores);
          if (p.data.stores.length > 0) {
            setStoreId(p.data.stores[0].id);
          }
        }
      })
      .catch(() => {
        // 门店加载失败不影响注册表单主流程
      });
  }, []);

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
          alsoDriver,
          storeId: alsoDriver ? storeId : undefined
        })
      });
      const payload = (await response.json()) as RegisterResponse;

      if (!payload.success) {
        setError(`${payload.error}（traceId: ${payload.traceId}）`);
        return;
      }

      const driverMsg = payload.data.driverId ? "&driver=1" : "";
      router.replace(`/admin/login?registered=1${driverMsg}&next=%2Fadmin%2Fmap`);
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
        <h2 className="text-2xl font-semibold text-slate-900">管理员注册</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          使用手机号创建运营管理员账号，注册成功后返回登录页。
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">手机号账号</span>
        <input
          type="tel"
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
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      {/* 一人多角色：同时注册为司机 */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={alsoDriver}
          onChange={(event) => setAlsoDriver(event.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        />
        <span className="text-sm font-medium text-slate-900">
          同时注册为司机（可登录小程序端接单）
        </span>
      </label>

      {alsoDriver && stores.length > 0 ? (
        <label className="flex flex-col gap-2 text-sm text-slate-700">
          <span className="font-medium text-slate-900">所属门店</span>
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900 bg-white"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {alsoDriver && stores.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          门店列表加载中或暂无可用门店，请稍后重试。
        </div>
      ) : null}

      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>当前阶段默认注册为运营管理员权限。</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || (alsoDriver && !storeId)}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "注册中..." : "注册"}
      </button>
    </form>
  );
}

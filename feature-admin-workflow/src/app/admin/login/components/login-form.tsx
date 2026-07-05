"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginResponse =
  | {
      success: true;
      data: {
        id: string;
        email: string;
        name: string;
        role: string;
        driverId?: string;
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

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [account, setAccount] = useState("admin@dispatch.dev");
  const [password, setPassword] = useState("admin123");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ account, password })
      });
      const payload = (await response.json()) as LoginResponse;

      if (!payload.success) {
        setError(`${payload.error}（traceId: ${payload.traceId}）`);
        return;
      }

      // 角色分流：司机走 driver 工作台，管理员/调度员走 admin 后台
      if (payload.data.driverId) {
        router.replace("/driver/tasks");
      } else {
        router.replace(nextPath);
      }
      router.refresh();
    } catch {
      setError("登录失败，请稍后重试");
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
        <h2 className="text-2xl font-semibold text-slate-900">管理员登录</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          使用管理员账号和密码登录后，可访问调度后台。
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">账号</span>
        <input
          type="text"
          autoComplete="username"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm text-slate-700">
        <span className="font-medium text-slate-900">密码</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded-xl border border-slate-300 px-4 outline-none ring-0 transition focus:border-slate-900"
        />
      </label>

      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>默认种子账号：</p>
        <p>账号：admin@dispatch.dev</p>
        <p>密码：admin123</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "登录中..." : "登录"}
      </button>

      <button
        type="button"
        className="text-sm text-slate-600 underline underline-offset-4"
        onClick={() => router.push("/admin/register")}
      >
        没有账号，去注册
      </button>
    </form>
  );
}

import Link from "next/link";

import { shouldShowDemoCredentials } from "@/lib/auth/public-registration";

export default function HomePage() {
  const showDemoCredentials = shouldShowDemoCredentials();
  return (
    <main className="h-dvh overflow-y-auto bg-slate-50 px-6 py-12 sm:py-16">
      <div className="mx-auto flex max-w-md flex-col items-center gap-8 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl tracking-tight text-slate-900">
          🚗 人车单调度系统
        </h1>
        <p className="text-base leading-7 text-slate-600">
          请选择要进入的工作台。
        </p>
        <div className="flex w-full flex-col gap-4 sm:flex-row">
          <Link
            href="/admin/map/v2"
            className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            调度员工作台
          </Link>
          <Link
            href="/driver/tasks"
            className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            司机工作台
          </Link>
        </div>
        {showDemoCredentials ? (
          <p className="text-xs text-slate-400">
            默认账号 admin@dispatch.dev / admin123
          </p>
        ) : null}
      </div>
    </main>
  );
}

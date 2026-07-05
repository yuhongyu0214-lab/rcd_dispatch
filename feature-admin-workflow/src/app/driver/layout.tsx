import Link from "next/link";

import { requireDriverPage } from "@/lib/auth/current-user";

import { DriverGpsTracker } from "./components/driver-gps-tracker";

export default async function DriverLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await requireDriverPage();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              🚗 司机工作台
            </h1>
            <p className="text-xs text-slate-500">{user.name}</p>
          </div>
          <DriverGpsTracker driverId={user.driverId!} />
        </div>
      </header>

      {/* 主内容 */}
      <main className="mx-auto max-w-lg px-4 py-4">{children}</main>

      {/* 底部导航栏 */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg justify-around py-2">
          <Link
            href="/driver/tasks"
            className="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-slate-600"
          >
            <span className="text-lg">📋</span>
            <span>工单</span>
          </Link>
          <Link
            href="/admin/orders"
            className="flex flex-col items-center gap-0.5 px-4 py-1 text-xs text-slate-400"
          >
            <span className="text-lg">⚙️</span>
            <span>后台</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}

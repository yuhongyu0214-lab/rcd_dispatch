import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16">
      <div className="mx-auto flex max-w-md flex-col items-center gap-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          🚗 人车单调度系统
        </h1>
        <p className="text-base leading-7 text-slate-600">
          汽车租赁可视化调度平台。订单管理 · 地图看板 · 推荐派单 · 调度闭环。
        </p>
        <div className="flex gap-4">
          <Link
            href="/admin/login"
            className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            后台登录
          </Link>
          <Link
            href="/driver/tasks"
            className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            司机工作台
          </Link>
        </div>
        <p className="text-xs text-slate-400">
          默认账号 admin@dispatch.dev / admin123
        </p>
      </div>
    </main>
  );
}

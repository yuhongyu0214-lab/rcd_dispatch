import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";

import { LoginForm } from "./components/login-form";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: {
    next?: string;
    registered?: string;
  };
}) {
  const currentUser = await getCurrentUser();
  const nextPath =
    searchParams.next && searchParams.next.startsWith("/admin")
      ? searchParams.next
      : "/admin/import";

  if (currentUser?.role === "admin") {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-12 text-slate-900">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
              Admin Auth
            </p>
            <h1 className="mt-2 text-3xl font-semibold">后台登录</h1>
          </div>
          <Link href="/" className="text-sm text-slate-600 underline underline-offset-4">
            返回首页
          </Link>
        </div>

        {searchParams.registered === "1" ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
            注册成功，请使用手机号账号和密码登录。
          </div>
        ) : null}

        <LoginForm nextPath={nextPath} />
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";

import { RegisterForm } from "./components/register-form";

export default async function AdminRegisterPage() {
  const currentUser = await getCurrentUser();

  if (currentUser?.role === "admin") {
    redirect("/admin/map");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-12 text-slate-900">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
              Admin Auth
            </p>
            <h1 className="mt-2 text-3xl font-semibold">后台注册</h1>
          </div>
          <Link
            href="/admin/login?next=%2Fadmin%2Fmap"
            className="text-sm text-slate-600 underline underline-offset-4"
          >
            返回登录
          </Link>
        </div>

        <RegisterForm />
      </div>
    </main>
  );
}

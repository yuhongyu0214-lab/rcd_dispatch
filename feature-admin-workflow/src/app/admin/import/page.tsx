import Link from "next/link";

import { LogoutButton } from "@/app/admin/components/logout-button";
import { requireAdminPage } from "@/lib/auth/current-user";

import { ImportUploadForm } from "./components/import-upload-form";

export default async function ImportPage() {
  const currentUser = await requireAdminPage("/admin/import");

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-12 text-slate-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
              Admin Import
            </p>
            <h1 className="mt-2 text-3xl font-semibold">订单导入中心</h1>
            <p className="mt-2 text-sm text-slate-600">
              当前登录：{currentUser.name}（{currentUser.email}）
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-slate-600 underline underline-offset-4">
              返回首页
            </Link>
            <LogoutButton />
          </div>
        </div>

        <ImportUploadForm />
      </div>
    </main>
  );
}

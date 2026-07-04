import { LogoutButton } from "@/app/admin/components/logout-button";
import { requireAdminPage } from "@/lib/auth/current-user";

import { ImportResultView } from "../components/import-result-view";

export default async function ImportResultPage({
  searchParams
}: {
  searchParams: {
    batchId?: string;
  };
}) {
  const currentUser = await requireAdminPage(
    `/admin/import/result${searchParams.batchId ? `?batchId=${encodeURIComponent(searchParams.batchId)}` : ""}`
  );

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-12 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <div className="text-sm text-slate-600">
            当前登录：{currentUser.name}（{currentUser.email}）
          </div>
          <LogoutButton />
        </div>
        <ImportResultView batchId={searchParams.batchId ?? null} />
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/current-user";
import { resolveAdminOrdersDestination } from "@/lib/navigation/admin-route-policy";

import { OrdersWorkflow } from "./components/orders-workflow";

export default async function AdminOrdersPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { mode } = await searchParams;
  const destination = resolveAdminOrdersDestination(mode);
  await requireAdminPage(destination ?? `/admin/orders?mode=${mode}`);

  if (destination) {
    redirect(destination);
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <OrdersWorkflow />
    </main>
  );
}

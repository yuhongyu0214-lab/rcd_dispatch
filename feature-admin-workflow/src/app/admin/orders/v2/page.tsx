import { DispatcherOrderPool } from "@/app/admin/components/dispatcher-order-pool";
import { requireAdminPage } from "@/lib/auth/current-user";

export default async function DispatcherOrdersV2Page() {
  await requireAdminPage("/admin/orders/v2");

  return (
    <main className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <DispatcherOrderPool />
    </main>
  );
}

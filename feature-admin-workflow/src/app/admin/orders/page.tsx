import { requireAdminPage } from "@/lib/auth/current-user";

import { OrdersWorkflow } from "./components/orders-workflow";

export default async function AdminOrdersPage() {
  await requireAdminPage("/admin/orders");

  return (
    <main className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <OrdersWorkflow />
    </main>
  );
}

import { requireAdminPage } from "@/lib/auth/current-user";

import { MapBoard } from "./components/map-board";

export default async function AdminMapPage() {
  await requireAdminPage("/admin/map");

  return (
    <main className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <MapBoard
        amapKey={process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? ""}
        amapSecurityCode={process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE ?? ""}
      />
    </main>
  );
}

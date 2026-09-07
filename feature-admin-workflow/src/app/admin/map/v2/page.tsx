import { DispatcherConsole } from "@/app/admin/components/dispatcher-console";
import { requireAdminPage } from "@/lib/auth/current-user";

export default async function DispatcherMapV2Page() {
  await requireAdminPage("/admin/map/v2");

  return (
    <main className="h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <DispatcherConsole
        entry="map"
        amapKey={process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? ""}
        amapSecurityCode={process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE ?? ""}
      />
    </main>
  );
}

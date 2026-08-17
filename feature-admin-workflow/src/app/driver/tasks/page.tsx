import { getCurrentUser } from "@/lib/auth/current-user";

import { DriverWorkspace } from "../components/driver-workspace";
import { getVisibleDisplayValue } from "../components/driver-task-display";

export default async function DriverTasksPage() {
  const user = await getCurrentUser();

  if (!user?.driverId) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-16 text-center text-sm text-slate-500">
        暂无司机身份，请联系管理员绑定。
      </div>
    );
  }

  return (
    <DriverWorkspace
      driverId={user.driverId}
      driverName={getVisibleDisplayValue(user.name) ?? "司机工作台"}
      amapKey={process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? ""}
      amapSecurityCode={process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE ?? ""}
    />
  );
}

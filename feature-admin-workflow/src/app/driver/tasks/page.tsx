import { requireDriverPage } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

import { DriverWorkspace } from "../components/driver-workspace";
import { DriverProfileSetup } from "../components/driver-profile-setup";
import { getVisibleDisplayValue } from "../components/driver-task-display";

export default async function DriverTasksPage() {
  const user = await requireDriverPage();

  if (!user.driverId) {
    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { phone: true }
    });
    const existing = account
      ? await prisma.driver.findUnique({
          where: { phone: account.phone },
          select: {
            isActive: true,
            user: { select: { id: true } },
            store: {
              select: { id: true, code: true, name: true, isActive: true }
            }
          }
        })
      : null;
    let blockedReason: string | undefined;
    if (!account) blockedReason = "账号状态已变化，请重新登录。";
    else if (existing?.user)
      blockedReason = "同手机号司机档案已关联其他账号，请联系管理员核对。";
    else if (existing && (!existing.isActive || !existing.store.isActive)) {
      blockedReason =
        "原司机档案或所属门店已停用，请联系管理员核对；不会自动恢复派单。";
    }
    const stores = existing
      ? [
          {
            id: existing.store.id,
            code: existing.store.code,
            name: existing.store.name
          }
        ]
      : blockedReason
        ? []
        : await prisma.store.findMany({
            where: { isActive: true },
            select: { id: true, code: true, name: true },
            orderBy: { code: "asc" }
          });
    return (
      <DriverProfileSetup
        stores={stores}
        existingStoreId={existing?.store.id}
        blockedReason={blockedReason}
      />
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

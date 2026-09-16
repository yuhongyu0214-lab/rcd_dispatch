import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isPublicAdminRegistrationEnabled } from "@/lib/auth/public-registration";
import { isAdminRole } from "@/lib/auth/roles";
import { ADMIN_MAP_V2_PATH } from "@/lib/navigation/admin-route-policy";
import { prisma } from "@/lib/prisma";

import { RegisterForm } from "./components/register-form";

export const dynamic = "force-dynamic";

export default async function AdminRegisterPage() {
  const allowInvitationRegistration =
    (process.env.WORKSPACE_REGISTRATION_INVITE_SECRET?.trim().length ?? 0) >=
    32;
  if (
    !allowInvitationRegistration &&
    !isPublicAdminRegistrationEnabled()
  ) {
    notFound();
  }
  const currentUser = await getCurrentUser();

  if (currentUser && isAdminRole(currentUser.role)) {
    redirect(ADMIN_MAP_V2_PATH);
  }
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" }
  });

  return (
    <main className="h-dvh overflow-y-auto bg-slate-100 px-6 py-12 text-slate-900">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">
              Account Registration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">账号注册</h1>
          </div>
          <Link
            href="/admin/login"
            className="text-sm text-slate-600 underline underline-offset-4"
          >
            返回登录
          </Link>
        </div>

        <RegisterForm
          stores={stores}
          requiresInviteCode={allowInvitationRegistration}
        />
      </div>
    </main>
  );
}

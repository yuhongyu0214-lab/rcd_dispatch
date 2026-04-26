import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { SectionCard } from "@/components/layout/section-card";
import { authOptions } from "@/lib/auth";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  return (
    <PageShell contentClassName="gap-6">
      <SectionCard>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary">
            Admin
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            登录成功，已进入后台入口页
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            第三阶段已恢复最小登录闭环。当前页面用于验证会话生效，后续功能将在这里继续承接。
          </p>
      </SectionCard>

      <SectionCard>
          <h2 className="text-xl font-semibold">当前会话</h2>
          <div className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
            <p>用户名：{session.user.name ?? "未提供"}</p>
            <p>邮箱：{session.user.email ?? "未提供"}</p>
          </div>
          <Link className="mt-6 inline-flex text-sm text-primary" href="/">
            返回首页
          </Link>
      </SectionCard>
    </PageShell>
  );
}

import { PageShell } from "@/components/layout/page-shell";
import { SectionCard } from "@/components/layout/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

const stageItems = [
  "第 1 阶段：项目可启动",
  "第 2 阶段：数据库连通",
  "第 3 阶段：登录流程",
  "第 4 阶段：目录结构整理",
  "第 5 阶段：工程规范稳定"
];

export default function HomePage() {
  return (
    <PageShell>
      <SectionCard>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary">
            feature/repo-bootstrap
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            人车单调度系统 Bootstrap 骨架已建立
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            当前目标是先把工程底座搭稳，确保开发服务器、首页入口、统一响应和共享骨架可以稳定工作，再继续进入后续业务分支。
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <StatusBadge tone="primary">App Router</StatusBadge>
            <StatusBadge>TypeScript</StatusBadge>
            <StatusBadge>Tailwind CSS</StatusBadge>
          </div>
      </SectionCard>

      <SectionCard className="grid gap-4 md:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">当前验收目标</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
              <li>1. `pnpm install` 成功</li>
              <li>2. `pnpm dev` 正常启动</li>
              <li>3. `http://localhost:3000` 可访问</li>
            </ul>
          </div>
          <div>
            <h2 className="text-xl font-semibold">后续阶段预告</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
              {stageItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
      </SectionCard>
    </PageShell>
  );
}

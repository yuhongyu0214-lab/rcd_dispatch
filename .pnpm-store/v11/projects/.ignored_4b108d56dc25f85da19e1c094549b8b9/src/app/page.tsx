const stageItems = [
  "第 1 阶段：项目可启动",
  "第 2 阶段：数据库连通",
  "第 3 阶段：登录流程",
  "第 4 阶段：目录结构整理",
  "第 5 阶段：工程规范稳定"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary">
            feature/repo-bootstrap
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            人车单调度系统已完成第一阶段启动骨架
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            当前目标是先把工程底座搭稳，确保开发服务器、首页入口和基础配置可以稳定工作，再继续进入连库与登录阶段。
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-blue-50 px-4 py-2 text-primary">
              App Router
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-slate-700">
              TypeScript
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-slate-700">
              Tailwind CSS
            </span>
          </div>
        </section>

        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm md:grid-cols-2">
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
        </section>
      </div>
    </main>
  );
}

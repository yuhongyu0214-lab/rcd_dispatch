# 人车单应用框架与依赖决策日志 V2

> 决策版本：`RCD-APP-DECISIONS-V2.0-R3-20260803`
> 状态：Gate 3 应用安全基线已批准
> 唯一代码事实：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`

本文件只记录应用框架、依赖来源和兼容边界。产品行为、HTTP 契约、领域枚举、数据模型和生产基础设施仍分别由对应权威文档定义。

## APP-001：升级 Next.js 与 React 安全基线

- 日期：2026-08-01
- 状态：`ACCEPTED`
- 决定：锁定 Next.js `15.5.21`、React / React DOM `19.2.8`，继续使用 App Router、TypeScript、Tailwind CSS 3、shadcn/ui、Prisma 6、Pino 和 Vitest。
- 原因：继承的旧框架基线存在无法在原 major 版本内完整消除的已知高危依赖问题；升级后完整依赖审计为 0 个已知漏洞。
- 兼容处理：动态路由 `params`、页面 `searchParams` 和 `cookies()` 改为按 Next.js 15 规则异步读取；ESLint 改用 flat config。
- 不改变：产品行为、HTTP 方法/路径/鉴权/DTO/状态码、领域枚举、Prisma Schema 和 migration。
- 复核：冻结锁文件安装后执行完整审计、446 项测试、lint、类型检查、Prisma generate/validate 和生产构建。

## APP-002：SheetJS 使用官方固定来源

- 日期：2026-08-01
- 状态：`ACCEPTED`
- 决定：`xlsx` 固定为 SheetJS 官方 CDN 包 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`。
- 原因：替换 npm 上长期未更新且存在已知漏洞的 `xlsx 0.18.x`，同时保持现有 Excel 导入行为。
- 安全边界：来源 URL 和版本必须同时固定；更换来源或版本视为依赖基线变更，必须重新审计与回归。
- 行为证据：有效模板解析和缺列拒绝回归通过；外部导入字段与错误语义未改变。

## APP-003：pnpm overrides 属于可审计安全基线

- 日期：2026-08-01
- 状态：`ACCEPTED`
- 决定：保留候选 `package.json` 中的精确 overrides，用于锁定已修复的传递依赖，并移除当前运行路径不需要的 Next.js 可选 `sharp` 包。
- 边界：不得用 override 掩盖运行时不兼容；任何调整都必须重新生成锁文件并复跑完整审计、测试和构建。
- 当前结果：完整依赖审计 0 个已知漏洞。

## APP-004：框架适配不构成业务契约或数据库变更

- 日期：2026-08-01
- 状态：`ACCEPTED`
- 结论：本次安全返修只改变框架/依赖版本及其内部调用方式。
- HTTP：方法、路径、鉴权主体、请求/响应字段、状态码、错误码、分页、幂等和 traceId 语义均不变。
- 枚举：Prisma 与 V2 DTO 的业务枚举均不变。
- 数据：`prisma/schema.prisma` 与 9 个 migration 内容均不变。
- UI：现有 CSS 设计变量值不变；完整索引见 `project-rules-v2.md` §5.2。

## APP-005：应用候选与部署平台解耦

- 日期：2026-08-01
- 状态：`ACCEPTED`
- 决定：应用候选 SHA 只证明代码、依赖、契约和 migration 内容；不自动证明任何云平台已经达到生产条件。
- Railway：已有 app/worker 运行记录只作为历史 Demo 证据，不再出现在现行 CLAUDE、README 或 runbook 的生产操作步骤中。
- 生产平台：由 Gate 3-R 基础设施权威文档和后续真实部署证据另行裁决；不得从本决策推定阿里云资源已经部署或 Gate 3 已 PASS。

## 版本记录

| 版本 | 日期       | 内容                                                                                                                                |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V2.0 | 2026-08-01 | 冻结 Next.js 15.5.21、React 19.2.8、SheetJS 官方 CDN 0.20.3、pnpm overrides、外部契约/枚举/Schema 零变化与应用候选/部署平台解耦决策 |
| V2.0-r1 | 2026-08-02 | 对齐部署可用性返修后的唯一候选；Docker/健康检查/OpenSSL 与 ACR 发布属于既有平台解耦决策的实施证据，不改变 APP-001～005 |
| V2.0-r2 | 2026-08-02 | 对齐部署入口加固候选；Compose profile、分阶段启动与 trace 入口过滤属于既有部署决策的实施证据，不新增或修改 APP-001～005 |
| V2.0-r3 | 2026-08-03 | 对齐 Compose 命令修正候选 `492c86ea...`；仅部署说明与测试发生变化，不新增或修改 APP-001～005，框架、依赖来源和外部兼容边界保持不变 |

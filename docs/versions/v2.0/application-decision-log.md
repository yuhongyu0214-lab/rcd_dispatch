# 人车单应用框架与依赖决策日志 V2

> 决策版本：`RCD-APP-DECISIONS-V2.0-R8-20260913`
> 状态：APP-008 一号双端本地实现通过；预生产仍为 APP-007，邀请码注册为下一版计划
> 代码事实：预生产运行 `codex/preprod-login-mobile-remediation @ b2887d3718f34bf3cc068d07b505d33065e77c7c`；上一稳定运行版本为 `4d370d664c3710a4a03cb1b665cfdeddc7d32778`

本文件只记录应用框架、依赖来源、应用集成决策和兼容边界。产品行为、HTTP 契约、领域枚举、数据模型和生产基础设施仍分别由对应权威文档定义。

## APP-001：升级 Next.js 与 React 安全基线

- 日期：2026-08-01；2026-09-11 patch 更新
- 状态：`ACCEPTED`
- 决定：锁定 Next.js `15.5.24`、React / React DOM `19.2.8`，继续使用 App Router、TypeScript、Tailwind CSS 3、shadcn/ui、Prisma 6、Pino 和 Vitest。
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

## APP-006：Gate 4 运行镜像与传递依赖安全返修例外

- 日期：2026-09-03
- 状态：`ACCEPTED`（已批准的本地返修决策补记，不是远端发布授权）
- 背景：`857705e…` RC 的固定 R55 扫描仍有未裁决 P0/P1；不能继续使用其历史豁免替代修复。
- 决定：本候选运行阶段采用固定 digest 的 `gcr.io/distroless/nodejs22-debian13:nonroot`；构建阶段继续使用 Dockerfile 锁定的 Node 22/Bookworm，不升级 ECS 宿主系统、不更换 Nginx。Prisma 保持 `6.19.3`，批准精确 override `deepmerge-ts 8.0.0`；依赖来源与其余版本以候选 package/lock 为准，不扩展为任意 major 升级授权。
- 兼容证据：`4d370d6…` 的实际运行 Node 为 `22.23.2`、UID/GID 为 `65532:65532`；bcrypt、Prisma CLI、worker 心跳、app 健康检查与完整 `813 passed / 7 expected skipped`、lint、TypeScript 通过。生产构建已有 `31/31` 日志与实际镜像证据，最后一轮独立复审未重复构建。
- 不改变：Next.js 模块化单体、阿里云 ECS + Docker + Nginx、RDS/Tair/SLS、HTTP-only 单 worker、app/worker/migration 同一镜像；业务代码、API、Schema、19 份 SQL 和设计规则均未修改。
- 安全结论边界：本地精确镜像在固定 R55 漏洞库（2026-09-01）下 Critical/High 均为 0；不代表其他等级、最新漏洞库、真实构建配置或远端 RC 已通过。详细身份与报告哈希见[状态总览](../../status/README.md#gate-4-本地安全返修证据2026-09-03)。
- 运行约束：无 shell 的 exec-form 启动、健康检查和 migration 入口以[部署指南 §5.1](deployment-guide-v2.md#51-gate-4-无-shell-运行镜像与制品验收)为准；不得为排障向运行镜像补装 shell、包管理器、setuid/setgid 工具或 mount/umount。
- 失效条件：更换基础镜像 digest、override、Prisma/原生模块、启动命令或运行权限后，必须重新进行兼容、完整工程和精确制品安全验收；不得沿用本地报告宣布新制品通过。
- 批准人：用户；授权与独立复审记录见本轮审计证据。Git/ACR 推送、真实配置重建与部署均另行授权。

## APP-007：post-Gate-4 登录返修与 Next.js patch 升级

- 日期：2026-09-11
- 状态：`ACCEPTED / PREPROD_DEPLOYED`
- 决定：以 `bc3cb212844bf7bdc781a5dd25459a6759f931b1` 修复登录后司机目标保持逻辑，再以 `b2887d3718f34bf3cc068d07b505d33065e77c7c` 将 `next` 与 `eslint-config-next` 精确升级到 `15.5.24`；React / React DOM 保持 `19.2.8`。
- 兼容边界：未修改 HTTP 方法/路径/DTO/状态码、业务状态机、领域枚举、Prisma Schema、migration、SQL 或设计变量；19/19 SQL raw checksum 与 Git 一致且 CR=0。
- 验收：完整工程回归、31/31 生产构建与 Prisma 校验通过；固定镜像 index `sha256:c491f6a48007b86b22af2c6a4f514ba94167e33b6dc0e33f046270b52102d1ed`、amd64 manifest `sha256:cde35c27c322090618bb71cd141b25c0ed9a59e5d278822868ba0d2db40de886`，Critical/High/Secrets 均为 0，运行 UID/GID 为 `65532:65532`。
- 运行结论：app、单 worker 与 Nginx release revision 已对齐 `b2887d3…`；Nginx 镜像、TLS 和端口未变，未执行 migration，健康/登录 200 与 HTTP 308 通过，可进入预生产真机测试。
- 限制：该结论只覆盖当前固定 digest 和预生产运行；不自动授权合入 main、替换正式生产 T0 代码基线或正式生产发布。

## APP-008：一号双端应用鉴权与档案集成

- 日期：2026-09-13；状态：`ACCEPTED / LOCAL_VALIDATION_PASS / NOT_DEPLOYED`。
- 来源：用户明确要求所有注册账号共享 Web 调度与 H5 能力；产品定义见 [PRD §7.4](prd-v2.md#74-一号双端2026-09-13-用户裁决)，HTTP 定义见 [API §1.7、§2.5～2.6](api-contract-v2.md)。不由本日志替代产品或 API 权威。
- 实现：本地 `feature/v2-dual-workspace-accounts @ 37d412c6510012a4ff01c773ab1cb21932e84aef`；扩展人类账号工作台守卫并保持安全 next 目标，缺司机档案进入完善页。User/Driver 创建与本人关联集中在 Serializable 事务，默认新司机离线；不批量修改历史 role、密码或已有绑定。
- 边界：H5 本人任务、系统/ingest 凭证和历史系统审计操作者选择不放宽；停用、占用和门店冲突拒绝自动处理。Schema、migration、依赖和设计变量不变；新增的是业务鉴权/开户兼容规则及一个 V2 账号端点，不沿用 APP-007 的“HTTP 零变化”结论。
- 本地证据：901 passed / 7 skipped、lint、tsc、32/32 build 与匿名 HTTP 冒烟通过；独立审查 P0=0/P1=0。真实 PostgreSQL 事务/ACL 与 Safari/微信/鸿蒙双端尚待验收；不能把本地 Mock/SSR 当成真机结果。
- 发布前置：按[部署指南 §7.7](deployment-guide-v2.md#77-一号双端发布前置尚未执行)核验最小 ACL、精确代码镜像、扫描及回退；脚本准备不等于 DB 授权已执行。本地代码 SHA、治理 SHA 和最近已核验运行 `b2887d3…` 分开记录。
- 后续计划：用户选择预生产邀请码开户，需在一号双端完成并经授权部署后再实施登录页注册按钮及 DB 链路；当前预生产/生产公开注册继续关闭，不能用开发模式或 app 通用 User 写权限临时放开。

## 版本记录

| 版本 | 日期       | 内容                                                                                                                                |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V2.0-r8 | 2026-09-13 | 新增 APP-008，登记用户批准的一号双端应用集成、本地验证、受控 DB 权限前置与邀请码注册下一版计划；明确未部署 |
| V2.0 | 2026-08-01 | 冻结 Next.js 15.5.21、React 19.2.8、SheetJS 官方 CDN 0.20.3、pnpm overrides、外部契约/枚举/Schema 零变化与应用候选/部署平台解耦决策 |
| V2.0-r1 | 2026-08-02 | 对齐部署可用性返修后的唯一候选；Docker/健康检查/OpenSSL 与 ACR 发布属于既有平台解耦决策的实施证据，不改变 APP-001～005 |
| V2.0-r2 | 2026-08-02 | 对齐部署入口加固候选；Compose profile、分阶段启动与 trace 入口过滤属于既有部署决策的实施证据，不新增或修改 APP-001～005 |
| V2.0-r3 | 2026-08-03 | 对齐 Compose 命令修正候选 `492c86ea...`；仅部署说明与测试发生变化，不新增或修改 APP-001～005，框架、依赖来源和外部兼容边界保持不变 |
| V2.0-r4 | 2026-08-08 | 对齐可观测性候选 `4eb3b485...`；发布 revision、结构化日志和轮转返修不新增或修改 APP-001～005，框架版本、依赖来源与外部兼容边界保持不变 |
| V2.0-r5 | 2026-08-10 | 对齐当前候选 `958afca...`；Gate 3 最小 E2E、ETA/H5 与全实例高德 3 QPS 限流返修不新增或修改 APP-001～005，框架版本、依赖来源和外部兼容边界保持不变 |
| V2.0-r6 | 2026-09-03 | 补记 APP-006：已批准的 Debian 13 Distroless 与 deepmerge-ts 8.0.0 本地安全例外；保留现有架构和本地/远端/部署分闸门边界 |
| V2.0-r7 | 2026-09-11 | APP-001 更新为 Next.js 15.5.24；新增 APP-007，登记登录目标返修、固定镜像扫描和预生产分阶段部署通过，main/正式生产权限不继承 |

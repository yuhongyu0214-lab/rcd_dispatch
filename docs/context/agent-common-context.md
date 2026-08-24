# 人车单 V2 Agent 公共上下文（Layer 0）

> 文档类型：`DERIVED / LAYER_0`
> 上下文版本：`RCD-AGENT-CONTEXT-20260824-R40`
> 适用范围：所有新建或重新启动的 Agent
> 权威范围：仅提供项目目标、当前阶段、公共纪律、模块边界和命令入口
> 非权威范围：产品行为、Schema、HTTP DTO、枚举、基础设施细节和任务验收标准
> 冲突处理：以 [文档版本总入口](../versions/README.md) 登记的领域权威为准；无法裁决时立即停止
> 使用要求：主控必须在任务单中提供代码基线、文档基线和本轮文件白名单；缺一项不得开工

## 1. 项目目标

人车单调度系统 V2 面向汽车租赁调度，主线是订单接入、实时位置、司机班次、A/B/C 工单时间轴、真实 ETA、调度事务和执行闭环。

Gate 3 已于 2026-08-11 最终裁决 `PASS`。串行调度员 API 已合入并通过 T1；2C 已合入本地 `develop` 并通过合入后回归，随后治理提交形成当前正式代码基线 `develop @ 2adae769caae1dce7f994de1d1ce63ab75b0fc36`。2B 唯一候选 `143a10a2aeff5ebacd1397a73a82d0ae3484a8da` 直接基于该正式基线，29 个文件边界、自测和独立代码审计均通过；当前为 `CODE_AUDIT_PASS / BROWSER_TEST_AUTHORIZED`。2A 候选 `6562544361b29579b4e52c059ce8f85db7b72722` 已 `EXIT_PASS`，在 2B 之后合入。`origin/develop` 仍为 `ae471484…`。

## 2. 当前版本与闸门

| 项目 | 当前事实 |
|---|---|
| 唯一代码候选 | `codex/v2-gate3-app-candidate` |
| 本地代码 SHA | `958afca537b412fb972b6e180561a9b37022834d` |
| 远程代码 SHA | `958afca537b412fb972b6e180561a9b37022834d`，已完成普通快进推送与远端核验 |
| 文档基线 | Gate 3 `PASS` 内容基线 `feature/v2-gate3-review-remediation @ 464ee5d6ffdb435d76b65f9814d82e4666fd84a9`，本地/upstream/GitHub 远程一致 |
| Gate 3→develop | 交接分支 `b853a7af245942758de1cd46c9a25c384c08ec62`；代码交接合并点 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`，本地/upstream/GitHub 远程一致 |
| 第二轮当前 develop | `2adae769caae1dce7f994de1d1ce63ab75b0fc36`；包含 2C 合入点 `04aba179…` 与其治理状态，初始基线 `f44afac…`、契约锚点 `f591aca…` 和数据补丁 `c6850df…` 均在祖先链 |
| 数据库实施 | 空 PostgreSQL 演练已验证 9 个 migration、最终 Schema、8 个 rollback 和 5 类护栏；真实预生产已完成备份、9 个 migration、最小权限和 G3E2E R2.2 基础资料 `3/6/5/8` 核验，owner 已关闭；首轮失败样本与本轮通过/失败事实均保留，禁止重复 bootstrap 或清理 |
| 候选状态 | `DEPLOYED / REAL_E2E_PASS / FAULT_ROLLBACK_PASS / FINAL_CONSISTENCY_RUNTIME_PASS`：代码、镜像、运行资源、真实 10 单和故障/回退证据一致 |
| 镜像 | app/worker 运行 `958afca…` → `sha256:13e0…5bff`；Nginx 原镜像/配置/证书/端口不变且 release revision 对齐；更早运行/回退候选继续保留，不得混用 |
| 基础设施 | 阿里云主线；ECS 上 app/worker/Nginx、自签名 HTTPS、结构化日志、`json-file` 轮转与 LoongCollector `3.2.6` 已验收；SLS 运行/安全日志、查询、脱敏、30/180 天留存、告警、通知和预算通过；正式域名/备案/可信证书延后 |
| Gate 3 | `PASS`（2026-08-11 最终裁决） |
| 第二轮并行 | 2C `MERGED_LOCAL / POST_MERGE_PASS`；2B `REBASED / SELF_TEST_PASS / CODE_AUDIT_PASS / BROWSER_TEST_AUTHORIZED`；2A `EXIT_PASS / MERGE_QUEUED_AFTER_2B` |
| Railway | 仅历史 Demo 证据，不是生产基线 |

状态变化只认 [项目状态总览](../status/README.md)；文档入口只认 [文档版本总入口](../versions/README.md)。

当前 Gate 3 运行候选仍为 `958afca…@sha256:13e0…5bff`，预生产、真实 10 单、故障恢复和回退证据保持不可变。2B 唯一候选 `143a10a…` 已直接基于 `2adae769…`，专项 `80/80`、2B/2C 联测 `29/29`、全量 `674 passed / 7 expected skipped`、lint、29/29 build、diff check、29 文件边界及独立代码审计通过。测试 Agent 现获准执行 Chrome、Edge × `360×800`、`390×844` 正式矩阵；修改白名单为空，外部系统授权为无。冻结浏览器测试 `PASS` 前仍不得合入，之后才轮到 2A。API r18 的 `DriverTaskV2.servicePlan` 读取契约目前只在 2B 候选中，合入前仍以 `develop` 的 API r17 为现行入口。不得把第 10 个 migration 投入预生产，不得连接预生产 RDS/Tair、真实高德，不得执行部署、重复基础资料或证据清理。

## 3. 公共模块边界

| 角色 | 默认关注范围 | 默认不得越界 |
|---|---|---|
| 主控 | 任务、优先级、进度、决策、闸门 | 不进入业务实现细节 |
| 前端 | 页面、组件、路由消费、API DTO | 不修改后端事务、Schema、调度核心 |
| 后端 | API、业务流程、鉴权、应用服务 | 不修改页面设计、云资源和无关 Schema |
| 数据库 | Schema、migration、rollback、索引、数据安全 | 不修改页面、API 实现和调度算法 |
| 地图调度 | 高德封装、位置、ETA、匹配和调度核心 | 不修改云资源、迁移和无关页面 |
| 代码审计 | 本轮 diff、架构、契约、数据库与安全 | 只审查，不参与实现 |
| 测试 | 验收标准、测试用例、回归范围 | 不扩大需求或修改权威规则 |

任务单的文件白名单比本表更严格；未列出的文件默认不可修改。

## 4. 公共开发规则

1. 开始前先核对分支、HEAD、代码基线、文档基线和工作区状态。
2. 一个 worktree 只服务一个阶段；分支流为 `feature/* → develop → main`。
3. 包管理器锁定 `pnpm@10.11.0`，禁止使用 npm 或 yarn。
4. 只做任务要求的最小修改，不顺手重构、改格式或修复无关问题。
5. API 使用项目统一响应、结构化错误、`traceId` 和 Pino 日志；禁止 `console.log`。
6. PostgreSQL 保存业务事实；Redis/Tair 只保存实时短期数据，不得反向覆盖事实库。
7. 高德服务端 Key 不得进入浏览器；ETA 不可用时禁止生成假 ETA。
8. 不读取、输出或提交 `.env.local`、数据库密码、云密钥和真实连接串。
9. 未经用户单独授权，不执行真实数据库迁移、部署、云资源或外部系统变更。
10. 发现权威文档冲突、基线不一致或任务越界时，立即停止并报告主控。

## 5. 工作目录与命令

应用目录：`feature-admin-workflow/`

```powershell
cd feature-admin-workflow
pnpm dev
pnpm test
pnpm lint
pnpm build
```

数据库命令仅供已获授权的数据库任务使用：

```powershell
npx prisma validate
npx prisma migrate dev
npx prisma db seed
npx prisma studio
```

执行前必须确认目标是本地、影子或明确获批的环境；不得默认连接真实 RDS/Tair。

## 6. Agent 启动检查

Agent 开工前必须向主控确认：

```text
角色：
任务目标：
代码基线 SHA：
文档基线 SHA：
允许读取的角色上下文：
允许修改的文件：
验收命令：
外部系统授权：无 / 明确列出
```

缺少代码 SHA、文档 SHA、文件白名单或验收标准时，只能进行只读盘点。

## 7. 强制停止条件

- 当前 HEAD 或任务来源不是主控指定基线。
- 必读文档存在未说明的未提交变化。
- API、Schema、枚举、状态或基础设施口径互相冲突。
- 任务要求修改其他角色的独占文件。
- 命令可能连接真实数据库、Redis/Tair、云平台或部署环境，但没有单独授权。
- 测试失败原因不明，或修复会扩大本轮范围。

## 8. 交付与上下文同步

Agent 只提交本轮交付和验证证据，不自行宣布 Gate 通过。

每个主对话回合结束时，项目 Hook 只提示是否需要同步文档；只有用户明确回复“提交并更新文档”后，Agent 才能按本轮事实更新相关文档。该口令不授权 Git 提交、推送或任何外部环境操作。

主控在阶段开始和结束时必须复核任务、进度、状态和决策。状态、决策、代码基线或任一角色必读文档发生变化时，应同步更新：

1. 对应领域权威或决策日志；
2. `docs/status/README.md`；
3. `docs/versions/README.md` 的版本与角色映射；
4. 本公共上下文中的当前事实；
5. `docs/rcd-v2-project-map.canvas`。

同步完成前，旧上下文不得继续用于新任务。

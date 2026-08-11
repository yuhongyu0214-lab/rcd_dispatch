# 人车单项目文档版本总入口

> 版本戳：`RCD-DOC-REGISTRY-20260811-R24`
> 建立日期：2026-07-13
> 治理更新时间：2026-08-10
> 归档方式：现行权威集中到 `v2.0/`；已融合或冲突的旧方案从工作树清场，历史由 Git 追溯
> 可视化导航：[Obsidian 项目全景白板](../rcd-v2-project-map.canvas)（仅作导航，不替代下方权威文档）

## 阅读规则

1. 新的产品、数据、调度和界面设计，以 `V2.0` 目录为当前依据。
2. 文档权威按领域拆分（见下），不做整份文档互相覆盖：工程纪律域以根目录 `AGENTS.md` 为准，各业务域以对应 V2 文档为准。
3. `V1` 目录只索引仍需维护现有 V1 代码的来源证据；已被 V2 吸收或与 V2 冲突的旧方案不保留可执行副本。
4. 未标版本的材料默认没有 V2 权威；只有文件顶部明确标注用途、且被本入口登记后，才能作为受限输入。
5. V2 回答、计划、验收和施工不得引用已删除旧路径；发现引用时按阻断级文档缺陷处理。
6. 状态报告只证明“做到哪一步”，不能覆盖产品、数据、API、枚举或基建权威文档。

## 当前有效版本

| 范围 | 当前版本 | 状态 | 入口 |
|---|---|---|---|
| 产品需求 | V2.0-r4 | Gate 3 H5 最小显示返修与 Gate 3 后司机端地图/排版专项已分开登记 | [PRD V2](v2.0/prd-v2.md) |
| 数据架构 | V2.0-r16 | 当前候选 Schema/migration tree 与冻结基线完全相同 | [数据架构 V2](v2.0/data-architecture-v2.md) |
| 代码与设计约束 | V2.0-r17 | 当前候选、真实 10 单和故障/回退事实已校正；业务规则和设计变量零变化 | [项目规则 V2](v2.0/project-rules-v2.md) |
| API 契约 | V2.0-r13 | 当前候选对外部 HTTP 契约零变化 | [API 契约 V2](v2.0/api-contract-v2.md) |
| 领域词汇 | V2.0-r13 | 当前候选领域术语与枚举零变化已登记 | [领域词汇 V2](v2.0/domain-glossary-v2.md) |
| 应用框架与依赖决策 | V2.0-r5 | 当前候选未改变框架、依赖来源或兼容边界 | [应用决策日志](v2.0/application-decision-log.md) |
| V1→V2 兼容映射 | V2.0 | Gate 0 已冻结 | [兼容矩阵](v2.0/v1-v2-compatibility-matrix.md) |
| 生产基础设施架构 | V2.0-r6 | Gate 3 `PASS` 文档基线 `464ee5d…` 已远程核验；架构与正式生产未决边界不变 | [基础设施架构 V2](v2.0/infrastructure-v2.md) |
| 构建、部署与回退 | V2.0-r13 | Gate 3 `PASS` 文档基线 `464ee5d…` 已远程核验；分阶段和禁止重复 migration 规则不变 | [部署指南 V2](v2.0/deployment-guide-v2.md) |
| 生产运行与恢复 | V2.0-r6 | 最终运行资源、健康、10 单、outbox 和证据一致性通过；整机/RDS 灾备仍为独立演练 | [运维指南 V2](v2.0/operations-guide-v2.md) |
| 基础设施决策与替代历史 | V2.0-r3 | INFRA-001～023 已登记；公网 IP 预生产演示获准，正式上线条件不变 | [基础设施决策日志](v2.0/infrastructure-decision-log.md) |
| 项目当前状态 | 2026-08-11 | Gate 3 最终 `PASS`；`b853a7a…` 已合入 `develop @ 51ddb5f…` 并远程核验；第二轮尚未启动 | [状态总览](../status/README.md) |
| Agent 公共上下文 | RCD-AGENT-CONTEXT-20260811-R23 | Layer 0；所有 Agent 必读；不超过 150 行；已接入 Codex 回合结束确认 Hook | [Agent 公共上下文](../context/agent-common-context.md) |
| V1 产品与开发主线 | V1.x | 历史只读 | [V1 历史索引](v1/README.md) |

## 文档权威顺序（按领域拆分，唯一权威口径）

同一事项只认领域对应的权威文档，文档之间不做整份互相覆盖：

```text
工程纪律                → AGENTS.md（工程铁律部分）
产品行为                → v2.0/prd-v2.md
数据模型                → v2.0/data-architecture-v2.md
术语与枚举              → v2.0/domain-glossary-v2.md
HTTP 契约               → v2.0/api-contract-v2.md
迁移与兼容              → v2.0/v1-v2-compatibility-matrix.md
代码一致性与设计系统    → v2.0/project-rules-v2.md
应用框架与依赖决策      → v2.0/application-decision-log.md
生产基础设施架构        → v2.0/infrastructure-v2.md
构建、部署与回退        → v2.0/deployment-guide-v2.md
生产运行与恢复          → v2.0/operations-guide-v2.md
基础设施决策与替代历史  → v2.0/infrastructure-decision-log.md
```

- 数据安全与不可逆操作原则高于以上一切。
- V1 文档仅用于追溯；原型、演示数据和临时说明不得反向定义规则。
- 同一事项在两份文档中冲突、且无法按领域判断归属时：**暂停实现并升级裁决**，不得自行取舍。

若代码与 V2 文档不一致，先记录差异并更新对应阶段计划，不得通过修改文档来掩盖代码现状。

## Agent 角色上下文直接入口

所有 Agent 先完整读取 [Agent 公共上下文](../context/agent-common-context.md)，再只读取自己的角色章节。Canvas 中的角色节点直接链接到以下入口；不建立独立角色派生文件。

| Agent 角色 | 可直接交给 Agent 的上下文路径 |
|---|---|
| 主控 | `docs/versions/README.md` → [主控 Agent](#主控-agent) |
| 前端 | `docs/versions/README.md` → [前端 Agent](#前端-agent) |
| 后端 | `docs/versions/README.md` → [后端 Agent](#后端-agent) |
| 数据库 | `docs/versions/README.md` → [数据库 Agent](#数据库-agent) |
| 地图调度 | `docs/versions/README.md` → [地图调度 Agent](#地图调度-agent) |
| 代码审计 | `docs/versions/README.md` → [代码审计 Agent](#代码审计-agent) |
| 测试 | `docs/versions/README.md` → [测试 Agent](#测试-agent) |

### 主控 Agent

- 默认必读：[状态总览](../status/README.md)、[应用决策日志](v2.0/application-decision-log.md)、[基础设施决策日志](v2.0/infrastructure-decision-log.md)、[并行开发主计划](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md)、[Gate 3-R 计划](../superpowers/specs/2026-07-29-gate3r-infrastructure-baseline-execution-plan.md)。
- 本轮追加：任务拆分、优先级、分支/SHA、验收报告和 Canvas。
- 不进入上下文：PRD、DTO、Schema 和业务代码细节。

### 前端 Agent

- 默认必读：[项目规则 V2](v2.0/project-rules-v2.md) 的页面/组件/设计章节、[API 契约 V2](v2.0/api-contract-v2.md) 的相关路由与 DTO、[PRD V2](v2.0/prd-v2.md) 的相关页面结构。
- 本轮追加：指定页面、组件、路由、公开环境能力和验收截图。
- 不进入上下文：Schema、migration、后端事务和调度核心。

### 后端 Agent

- 默认必读：[API 契约 V2](v2.0/api-contract-v2.md) 的相关接口、[PRD V2](v2.0/prd-v2.md) 的相关业务流程、[领域词汇 V2](v2.0/domain-glossary-v2.md) 的相关术语、[项目规则 V2](v2.0/project-rules-v2.md) 的服务分层规则。
- 本轮追加：指定鉴权规则、应用服务、外部服务可用性和测试范围。
- 不进入上下文：页面设计、云资源实施和无关 Schema。

### 数据库 Agent

- 默认必读：[数据架构 V2](v2.0/data-architecture-v2.md)、[兼容矩阵](v2.0/v1-v2-compatibility-matrix.md)、[部署指南 V2](v2.0/deployment-guide-v2.md) 的 migration/rollback 章节。
- 本轮追加：`schema.prisma`、本轮 migration/rollback、索引、manifest 和数据安全验收。
- 不进入上下文：页面、API 实现、调度算法和云资源操作。

### 地图调度 Agent

- 默认必读：[PRD V2](v2.0/prd-v2.md) 的调度规则、[数据架构 V2](v2.0/data-architecture-v2.md) 的位置/ETA 边界、[领域词汇 V2](v2.0/domain-glossary-v2.md) 的调度术语。
- 本轮追加：高德封装、位置模型、ETA、Redis/Tair 降级、匹配逻辑和对应测试。
- 不进入上下文：页面设计、migration、部署与云资源变更。

### 代码审计 Agent

- 默认必读：[项目规则 V2](v2.0/project-rules-v2.md)、本轮相关 [API 契约 V2](v2.0/api-contract-v2.md)；数据变更时追加 [数据架构 V2](v2.0/data-architecture-v2.md)。
- 本轮追加：本轮 diff、架构边界、Schema/migration diff、安全规则和验收证据。
- 不进入上下文：不相关业务文档和未来需求；只审查，不参与实现。

### 测试 Agent

- 默认必读：本轮计划中的验收标准，以及相关 API/数据契约章节。
- 本轮追加：指定测试文件、用例、Mock 条件、回归范围和失败判定。
- 不进入上下文：决策日志全文、无关实现和云资源建设细节。

### 未分配到默认角色上下文的文档

- [基础设施架构 V2](v2.0/infrastructure-v2.md)、[部署指南 V2](v2.0/deployment-guide-v2.md) 全文和[运维指南 V2](v2.0/operations-guide-v2.md)不进入所有 Agent 的公共上下文；只有主控明确创建基础设施任务并授权时才作为 Layer 2 提供。
- [V1 历史索引](v1/README.md)及受限历史输入只在 V1 维护、迁移或接入兼容任务中提供。
- 状态报告、审查报告和 migration 指纹只作为任务证据，不得覆盖对应领域权威。

### 上下文同步规则

状态、决策、代码基线或上表任一必读文档发生变化时，主控必须同步更新状态总览、本入口的版本/角色映射、Agent 公共上下文和 Canvas。同步完成前，不得把旧上下文交给新 Agent；若尚无可追溯的文档提交 SHA，Agent 只能进行只读盘点。

### Codex 回合结束文档确认

- 项目级 `.codex/hooks.json` 使用 `Stop` Hook，在每个主对话回合结束时提示：`如需提交项目状态上传到文档，回复"提交并更新文档"。`
- 提示本身不修改任何文件；只有用户明确回复该口令后，当前 Agent 才能根据本轮已确认事实同步相关文档。
- 口令只授权文档同步，不授权 Git 提交或推送，也不授权数据库、部署、云资源或其他外部系统操作。
- 没有发生变化的领域文档和决策日志不得为了“保持同步”而产生空修改。

## 已确定的基建与技术基线

| 层级 | 当前唯一结论 | 当前实施状态 |
|---|---|---|
| 正式生产云 | 中国大陆正式生产主线使用阿里云；Railway 仅保留历史 Demo 证据，CloudBase 仅限隔离预览/验证 | 架构已批准，阿里云生产尚未验收 |
| 运行与入口 | 单 ECS 试运行；Docker + Nginx；同一不可变镜像分别运行 Next.js app、HTTP-only 单副本 worker、一次性 migration | app、worker、Nginx、自签名 HTTPS 与外部健康/登录路由已验收；正式可信 HTTPS 延后 |
| 镜像与日志 | ACR 保存按 commit SHA 追溯的镜像；SLS 集中采集结构化日志 | ECS app/worker 当前按 `958afca…@sha256:13e0…5bff` 运行，Nginx 原镜像不变且 release revision 已对齐；本机轮转与 SLS 验收结论继续有效 |
| 事实数据库 | 阿里云 RDS PostgreSQL 是唯一业务事实库；Prisma 负责 ORM 与 migration | 上海独立预生产库已完成 0805 全量备份、9 个 migration 和最小权限验收；正式生产另建物理实例 |
| 实时数据 | 阿里云 Tair/Redis 保存最新位置、在线状态、ETA 短缓存和短锁，不得成为业务事实源 | 上海预生产 Tair 白名单与内网登录通过；app 运行后的前缀、锁竞争和降级验收仍待完成 |
| 地图与路径 | 高德 JS API 负责前端地图；高德服务端 API 负责地理编码、路径与真实 ETA | Key 分离，服务端 Key 不得进入浏览器 |
| 应用技术栈 | Next.js 15.5.21、React 19.2.8、TypeScript、Tailwind CSS 3、shadcn/ui、Prisma 6、Pino、Vitest | 应用候选已完成依赖审计与回归 |
| 构建与依赖 | pnpm 10.11.0；SheetJS 官方 CDN `xlsx 0.20.3`；受审计的精确 pnpm overrides | 已冻结，不得回退到 npm/yarn 或 npm `xlsx 0.18.x` |

详细组件职责、网络边界和未决事项分别见[基础设施架构 V2](v2.0/infrastructure-v2.md)与[基础设施决策日志](v2.0/infrastructure-decision-log.md)。本表是导航摘要，不替代原文。

## Gate 3 当前唯一应用候选

```text
branch: codex/v2-gate3-app-candidate
local commit: 958afca537b412fb972b6e180561a9b37022834d
remote commit: 958afca537b412fb972b6e180561a9b37022834d
```

- 当前唯一代码/ACR/预生产运行候选只认完整 SHA `958afca537b412fb972b6e180561a9b37022834d`。该候选包含 Gate 3 最小 E2E 入口、ETA 诊断/受控重试、司机地图读取一致性、H5 导航/测试标记过滤与全实例高德 `3 QPS` 限流，并保持外部 HTTP 契约、领域枚举、Schema、9 个 migration、依赖和设计变量不变。
- 最终 migration 清单与风险见 [2026-08-01 Gate 3 migration manifest](../status/2026-08-01-gate3-migration-manifest.md)，正向清单自身 SHA-256 为 `a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d`，全部 17 个 SQL 聚合 SHA-256 为 `b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f`。
- 最小显示与 ETA 返修构建证据见 [2026-08-09 最小 E2E 返修候选](../status/2026-08-09-gate3r-minimal-e2e-remediation-candidate.md)；随后加入全实例高德 `3 QPS` 限流形成 `958afca…@sha256:13e0…5bff`，本地、远程、ACR、预生产 app/worker 与 Nginx release revision 已对齐。冻结真实 10 单已通过：9 单完成，订单 7 按预期不可行并保留开放预警；第 6 单仅在独立证据中使用获准的 `-25` 目标，产品 `-30` 阈值、外部契约和数据结构零变化。详见[2026-08-10 真实 E2E 重验进度](../status/2026-08-10-gate3r-real-e2e-retest-progress.md)。既有运行/回退候选继续保留，运行不得使用 `latest` 或混用候选。
- 真实预生产数据库实施见 [2026-08-05 RDS 迁移与最小权限验收](../status/2026-08-05-gate3r-rds-preprod-migration-permissions.md)：0805 全量备份、冻结的 9 个 migration、对象 owner、逐表 app 白名单、worker 零数据库权限和 owner 长期入口关闭均通过。公网入口、app、worker、Nginx、本机日志护栏与 SLS 集中观测均已通过。
- 隔离基础资料实施见 [2026-08-09 G3E2E R2.2 基础资料写入与核验](../status/2026-08-09-gate3r-g3e2e-base-data-bootstrap.md)：bootstrap 时 `3` 个门店、`6` 个用户、`5` 名司机和 `8` 台车辆已由 app 身份精确核验且订单、班次、位置为 `0`。其后首轮正式 E2E 已写入并保留三单失败样本；不得重复整批写入或未经授权清理。
- 中间提交、来源分支和主工作区未提交文件仅用于历史追溯，不得作为 Gate 3 当前验收对象。
- Railway 既有部署只保留历史 Demo 证据；现行生产平台边界以 Gate 3-R 基建裁决为准，旧 README、CLAUDE 或 runbook 不得继续定义 Railway 生产步骤。

## 当前闸门与下一步

1. 权威文档内容审查、工程回归、9 个 migration 指纹和当前/上一/回退镜像追溯已经完成；`958afca…@sha256:13e0…5bff` 已进入 ACR 并在 ECS app/worker 运行，Nginx 仅刷新同一 release revision，预生产 9 个 migration 与数据库最小权限子闸门继续有效。
2. 新候选的 Schema/migration tree 与完成一次性空 PostgreSQL 演练的旧冻结候选完全相同；原有 9 个正向 migration、最终 Schema、8 个 rollback 和五类安全护栏结论继续有效。
3. 冻结真实 10 单已完成：订单 1～6、8～10 共 9 单完成，订单 7 按预期为 `INFEASIBLE` 且保留 1 条开放预警；并发、旧版本、到达后改排拒绝与订单 10 幂等重放均通过。首轮失败、旧映射、边界抖动和错误 helper 现场继续保留，不得清理。
4. 最终一致性审查确认本地/远程代码、ACR digest、ECS 运行身份、真实依赖、10 单结果和故障/回退证据一致；文档口径已返修，并以 `feature/v2-gate3-review-remediation @ 57ef86c43bf220f48774e130575c40b8c94a83d5` 形成可追溯基线，本地、upstream 与 GitHub 远程核验一致。
5. 主控已于 2026-08-11 最终裁决 Gate 3 `PASS`，PASS 文档内容基线 `feature/v2-gate3-review-remediation @ 464ee5d6ffdb435d76b65f9814d82e4666fd84a9` 已完成远程核验；交接分支 `feature/v2-gate3-develop-handoff @ b853a7af245942758de1cd46c9a25c384c08ec62` 已合入并推送，Gate 3 代码交接点为 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`。第二轮为 `AUTHORIZED / NOT_STARTED`，尚未创建分支；状态激活后必须从同一最终 `origin/develop` HEAD 启动 Web、司机接口和观测分支。不得因此重复部署、执行 migration、整批写入基础资料、清理失败样本或直接写业务数据库。

状态事实和阻断项统一在[状态总览](../status/README.md)维护；状态文档不得修改领域契约。

## 旧方案清场与保留边界

2026-08-01 已移除工作树中的旧生产升级、部署、高德、Tair、位置协议、V1 端到端执行和 demo API/UI 契约全文。可复用内容已经进入对应 V2 权威；冲突内容不再保留可执行副本。

仅保留三类受限历史输入：

| 材料 | 保留目的 | 禁止用途 |
|---|---|---|
| `docs/production-field-mapping.md` | 维护现有 V1 Adapter、追溯外部字段 | 定义 V2 CanonicalOrder、Schema、API 或状态机 |
| `docs/人车单-RDS-浏览器插件-字段对接优化方案.md` | 追溯浏览器插件原始字段和兼容链路 | 定义 V2 数据、API、调度或基建 |
| `docs/执行结果1_字段可用性评估.xlsx` | 保存原始字段评估证据 | 单独成为任何领域权威 |

完整删除清单、替代关系和恢复基线见[旧版方案清场报告](../superpowers/reports/2026-08-01-legacy-plan-removal-review.md)。Git 历史只用于审计和必要恢复，不得把旧文件恢复为现行规则。

## 新文档准入规则

新方案进入主线前必须同时满足：

1. 文件顶部写明版本、状态、权威范围、非权威范围和生效日期；
2. 在本 README 的领域表中登记唯一入口，或明确标为状态/证据/实施计划；
3. 不复制另一权威文档的枚举、DTO 或状态机，改用链接引用；
4. 变更权威口径时同步版本记录、兼容影响、验收证据和替代关系；
5. `DRAFT`、`PLAN`、`REPORT`、`SUPERSEDED` 不得被当成 `FROZEN` 或 `ACCEPTED`；
6. 无法按领域裁决的冲突必须暂停实施并由用户确认。

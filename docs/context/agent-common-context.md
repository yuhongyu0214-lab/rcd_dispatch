# 人车单 V2 Agent 公共上下文（Layer 0）

> 文档类型：`DERIVED / LAYER_0`
> 上下文版本：`RCD-AGENT-CONTEXT-20260917-R72`
> 适用范围：所有新建或重新启动的 Agent；权威范围：仅提供项目目标、当前阶段、公共纪律、模块边界和命令入口
> 非权威范围：产品行为、Schema、HTTP DTO、枚举、基础设施细节和任务验收标准
> 冲突处理：以 [文档版本总入口](../versions/README.md) 登记的领域权威为准；无法裁决时立即停止
> 使用要求：主控必须在任务单中提供代码基线、文档基线和本轮文件白名单；缺一项不得开工

## 1. 项目目标

人车单调度系统 V2 面向汽车租赁调度，主线是订单接入、实时位置、司机班次、A/B/C 工单时间轴、真实 ETA、调度事务和执行闭环。

Gate 3、第二轮、P2、3A/3B 与 Gate 4 已退出。联合账号与入口版本已提升为 `main == origin/main == 85bcfa534e5a3525f2bf84e0628bac4942559120`；其应用 tree 与审计候选 `40b4a0f…` 一致。post-Gate-4 旧预生产仍运行 `b2887d3…@sha256:c491f6a…d1ed`：app/单 worker healthy、Nginx revision 对齐且镜像/TLS/端口不变。新版本只完成不可变镜像与阶段 4 配置/ACL 前置，尚未切换 Nginx 或运行容器；正式生产资源仍未授权写入。

2026-09-13 一号双端来源为 `feature/v2-dual-workspace-accounts @ 463c9ee44352a66ec43b25a1ccb66453ae9826ed`，功能锚点 `37d412c6510012a4ff01c773ab1cb21932e84aef`；其真实 merge 历史已保留在联合候选。来源 worktree 保持只读，不能单独部署或作为新基线。

2026-09-17，R71 已普通快进推送，`develop == origin/develop == 14537ddaf92182b2f68308e66503d262490ce1e1`；随后以 `d9cdf2b…` 和 `14537dd…` 为双亲正常合并，形成并推送 `main == origin/main == 85bcfa534e5a3525f2bf84e0628bac4942559120`。main 的 `feature-admin-workflow` tree 为 `d4b38e4ea4136e18170137580f872180eea90a52`，与审计候选 `40b4a0f…` 一致；全量测试、lint、TypeScript、32/32 build 与 diff check 通过。不可变镜像锁定 `40b4a0f…`，远端 index/amd64/config 分别为 `sha256:0dc8315f…e09`、`sha256:0db7e694…c8e4`、`sha256:5283c65c…c8c5`，固定摘要漏洞与秘密扫描均为 0。

阶段 4 已由独立核验关闭：64 字符邀请密钥仅写入 app 预生产配置，文件仍为 `rcdops:rcdops 600`，明文未进入证据或运行中容器；数据库仅新增 `Driver INSERT`、`User INSERT`、`User UPDATE(driverId)`、`User UPDATE(updatedAt)` 四项，回退 SQL 4 条已保存。owner `NOLOGIN`、worker 零数据库权限、无授权转授和无额外权限保持；未重启容器、未执行 migration。证据目录为 `/srv/rcd-dispatch/backups/stage4-account-entry-20260916T152403Z`。阶段 5 Nginx 与阶段 6 分阶段部署/双端验收尚未授权；注册事务、邀请码实际使用和应用加载密钥必须留到阶段 6 验证。

## 2. 当前版本与闸门

| 项目 | 当前事实 |
|---|---|
| 联合账号与入口代码 | 候选 `40b4a0fca3c9f9b4cfd392341f89663fdbbcb418` 已进入 `develop/origin/develop @ 14537dd…` 和 `main/origin/main @ 85bcfa5…`；main 应用 tree 与候选一致；`MAIN_PROMOTED / MAIN_VALIDATION_PASS / NOT_DEPLOYED`；59 路径，无额外代码、Schema/migration |
| 一号双端本地代码 | `feature/v2-dual-workspace-accounts @ 37d412c6510012a4ff01c773ab1cb21932e84aef`；`LOCAL_VALIDATION_PASS / NOT_DEPLOYED`；代码 SHA 不等于后继治理 SHA |
| 本轮治理与后续 | R72 登记 R71 推送、main 提升/验证、不可变镜像以及阶段 4 配置/ACL `PASS_CONFIG_AND_ACL_ONLY`；预生产运行身份未变。阶段 5 Nginx 与阶段 6 部署/验收须分别授权 |
| Gate 3 历史代码候选 | `codex/v2-gate3-app-candidate` |
| Gate 3 历史本地 SHA | `958afca537b412fb972b6e180561a9b37022834d` |
| Gate 3 历史远程 SHA | `958afca537b412fb972b6e180561a9b37022834d`，已完成普通快进推送与远端核验 |
| Gate 3 历史文档基线 | `PASS` 内容基线 `feature/v2-gate3-review-remediation @ 464ee5d6ffdb435d76b65f9814d82e4666fd84a9`，本地/upstream/GitHub 远程一致 |
| Gate 3→develop | 交接分支 `b853a7af245942758de1cd46c9a25c384c08ec62`；代码交接合并点 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`，本地/upstream/GitHub 远程一致 |
| 第二轮与 P2 退出基线 | 2A/2B/2C 代码树锚点 `46813c3ecf4a0df1eaf99bfb3d8d72f7d450193b`；P2 候选 `0e354696…` 已合入 `develop @ 5c2760cea40b975b24d5d2201333ab5048ce1cf0`，合并父提交为 `78a708f…` 与 `0e354696…` |
| Gate 4 当前代码 | `feature/v2-stabilization @ 4d370d664c3710a4a03cb1b665cfdeddc7d32778`；应用 tree `5188c0efcb96d646a9609b7c47dd624d578841ee`；远端 RC 验收文档/源码可追溯后继为 `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6`，不作为 OCI revision |
| 数据库实施 | 预生产已由 9 条增至 10 条 migration，outbox CHECK 精确允许 17 种事件；app ACL 含 `OrderServicePlan INSERT/SELECT/UPDATE`，worker 零 DB 权限。`rcd_v2_preprod_owner.rolcanlogin=false` 保持；migration 绝对时间缺失已获一次性非阻断裁决，禁止重跑、改元数据或重开 owner 补证 |
| Gate 3 历史验收状态 | `DEPLOYED / REAL_E2E_PASS / FAULT_ROLLBACK_PASS / FINAL_CONSISTENCY_RUNTIME_PASS`：代码、镜像、运行资源、真实 10 单和故障/回退证据一致，不适用于 Gate 4 新候选 |
| Gate 3 运行镜像（最近记录） | app/worker 为 `958afca…` → `sha256:13e0…5bff`；Nginx release revision 对齐；更早运行/回退候选继续保留，不得混用；当前健康须在下一轮重新核验 |
| 基础设施 | 阿里云主线；ECS 上 app/worker/Nginx、自签名 HTTPS、结构化日志、`json-file` 轮转与 LoongCollector `3.2.6` 已验收；SLS 运行/安全日志、查询、脱敏、30/180 天留存、告警、通知和预算通过；正式域名/备案/可信证书延后 |
| Gate 3 | `PASS`（2026-08-11 最终裁决） |
| Gate 4 子闸门 | `G4_1_TO_G4_4_PASS / G4_5_FINAL_PASS_WITH_CONTROLLER_EXCEPTION`；Gate 4 总闸门 `PASS` |
| Gate 4 镜像 | 已验收远端 index `sha256:508dea2dfa25da76581adc89b33d2ccf73eb91a21af26fa8f54e08fd94fe453d`；完整 amd64/config 与扫描证据见状态总览；三个旧 RC `4102ee1… / a0c8bbd… / 857705e…` 继续 `REJECTED_DO_NOT_DEPLOY` |
| post-Gate-4 预生产返修 | `codex/preprod-login-mobile-remediation @ b2887d3718f34bf3cc068d07b505d33065e77c7c`；index `sha256:c491f6a48007b86b22af2c6a4f514ba94167e33b6dc0e33f046270b52102d1ed`、amd64 `sha256:cde35c27c322090618bb71cd141b25c0ed9a59e5d278822868ba0d2db40de886`；Critical/High/Secrets=0，19/19 SQL raw/CR=0，预生产冒烟 PASS、真机测试 READY、migration NO |
| 主线与下一步 | `develop == origin/develop == 14537ddaf92182b2f68308e66503d262490ce1e1`；`main == origin/main == 85bcfa534e5a3525f2bf84e0628bac4942559120`。镜像和阶段 4 前置已通过，但运行中预生产仍为 `b2887d3…`；下一步只允许先独立授权阶段 5，再在其通过后授权阶段 6 |
| Railway | 仅历史 Demo 证据，不是生产基线 |

状态变化只认 [项目状态总览](../status/README.md)，文档入口只认 [文档版本总入口](../versions/README.md)。Gate 3/Gate 4 运行证据和失败现场保留；当前 ECS app/worker 仍为 `b2887d3…@sha256:c491f6a…d1ed`，Nginx revision 对齐，第 10 条 migration 结论不变。新 `40b4a0f…` 镜像已验收，邀请密钥和最小 ACL 已落地但未由运行中 app 加载；不得把阶段 4 写成注册链路或部署 PASS。上一稳定 `4d370d6…@sha256:508dea…453d` 继续保留；阶段 5～6 不继承阶段 4 权限。

- G4-2/3：RDS/Tair 无公网入口，ECS 仅开放 80/443 且 SSH 受限；自签名只限预生产。SLS 留存/告警和 2026-08-30 隔离恢复库 9→10→9 演练通过，源预生产库零写入。
- G4-4/5：固定 RC 扫描与一次性预生产部署 `PASS_WITH_CONTROLLER_EXCEPTION`；恢复点 `3149081194`、配置备份和兼容回退有效。时间例外、扫描时点和正式生产边界见[主计划 §8.4.3](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md#843-g4-5-预生产继续联调方案t6-pass_with_controller_exceptiongate-4-pass)。

正式生产 T0 使用以下固定 Layer 2：

```text
ROLE=PRODUCTION_RELEASE_T0_READONLY_INVENTORY
CODE_BASELINE_SHA=85bcfa534e5a3525f2bf84e0628bac4942559120
DOCUMENT_BASELINE_SHA=<本轮 R72 治理提交完整 SHA>
MODIFICATION_WHITELIST=EMPTY
EXTERNAL_WRITE_AUTHORIZATION=NONE
```

T0 只盘点域名/备案、可信证书、ECS 复用、独立生产 RDS/Tair、ACR/SLS/DNS、成本、恢复与责任。优先低成本安全复用现有计算与公共基建，但生产 RDS、Tair、账号、秘密和数据不得复用预生产。任何购买、备案提交、云资源或配置变更、镜像、migration、部署和生产数据访问均须单独授权。

## 3. 公共模块边界

| 角色 | 默认关注范围 | 默认不得越界 |
|---|---|---|
| 主控 | 任务、优先级、进度、决策、闸门 | 不进入业务实现细节 |
| 运维发布 | 正式生产只读盘点、资源/成本/域名备案/证书/恢复与发布方案 | 未获逐项授权不得购买、创建资源、改配置、迁移或部署 |
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

每个子阶段必须保存命令输出、截图、traceId、digest、数据库与 SLS 核验等运行证据，但单项 `PASS` 不默认修改治理文档或产生 Git 提交。运行证据通常保存在受控验收目录、制品库或工单附件，不改变冻结的代码 RC SHA。

只有阶段组完成、结论稳定，且用户明确回复“提交并更新文档”取得 A8 文档同步授权后，Agent 才能统一更新相关治理文档。该口令不授权 Git 提交、推送或任何外部环境操作；Git 提交仍须另行批准。若验收中途必须修改跟踪文档才能继续，应暂停并重新申请 A8。

主控在阶段开始和结束时必须复核任务、进度、状态和决策。状态、决策、代码基线或任一角色必读文档发生变化时，应同步更新：对应领域权威或决策日志、`docs/status/README.md`、`docs/versions/README.md` 的版本与角色映射、本公共上下文中的当前事实、`docs/rcd-v2-project-map.canvas`。
同步完成前，旧上下文不得继续用于新任务。

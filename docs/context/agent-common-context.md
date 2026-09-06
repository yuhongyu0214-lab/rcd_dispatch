# 人车单 V2 Agent 公共上下文（Layer 0）

> 文档类型：`DERIVED / LAYER_0`
> 上下文版本：`RCD-AGENT-CONTEXT-20260906-R60`
> 适用范围：所有新建或重新启动的 Agent
> 权威范围：仅提供项目目标、当前阶段、公共纪律、模块边界和命令入口
> 非权威范围：产品行为、Schema、HTTP DTO、枚举、基础设施细节和任务验收标准
> 冲突处理：以 [文档版本总入口](../versions/README.md) 登记的领域权威为准；无法裁决时立即停止
> 使用要求：主控必须在任务单中提供代码基线、文档基线和本轮文件白名单；缺一项不得开工

## 1. 项目目标

人车单调度系统 V2 面向汽车租赁调度，主线是订单接入、实时位置、司机班次、A/B/C 工单时间轴、真实 ETA、调度事务和执行闭环。

Gate 3、第二轮、P2 与 3A/3B 已退出，G4-1～G4-4 保持 PASS。G4-5 T0 已 `PASS`：资源、网络、旧运行身份、9 条 migration、逐表权限、owner `NOLOGIN`、SLS 通知链路及 RDS 恢复点均已核验；最新可用全量自动备份 ID 为 `3149081194`，完成于 `2026-09-06T07:06:43Z`，当前 PITR 窗口为 `2026-08-31T07:07:02Z .. 2026-09-06T09:24:50Z`。新 RC 尚未部署，Gate 4 总闸门仍 `IN_PROGRESS`；T1-A 参数尚未冻结且未获授权。本轮只同步 5 份治理文档，不提交、推送、迁移或部署。

## 2. 当前版本与闸门

| 项目 | 当前事实 |
|---|---|
| Gate 3 历史代码候选 | `codex/v2-gate3-app-candidate` |
| Gate 3 历史本地 SHA | `958afca537b412fb972b6e180561a9b37022834d` |
| Gate 3 历史远程 SHA | `958afca537b412fb972b6e180561a9b37022834d`，已完成普通快进推送与远端核验 |
| Gate 3 历史文档基线 | `PASS` 内容基线 `feature/v2-gate3-review-remediation @ 464ee5d6ffdb435d76b65f9814d82e4666fd84a9`，本地/upstream/GitHub 远程一致 |
| Gate 3→develop | 交接分支 `b853a7af245942758de1cd46c9a25c384c08ec62`；代码交接合并点 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`，本地/upstream/GitHub 远程一致 |
| 第二轮与 P2 退出基线 | 2A/2B/2C 代码树锚点 `46813c3ecf4a0df1eaf99bfb3d8d72f7d450193b`；P2 候选 `0e354696…` 已合入 `develop @ 5c2760cea40b975b24d5d2201333ab5048ce1cf0`，合并父提交为 `78a708f…` 与 `0e354696…` |
| Gate 4 当前代码 | `feature/v2-stabilization @ 4d370d664c3710a4a03cb1b665cfdeddc7d32778`；应用 tree `5188c0efcb96d646a9609b7c47dd624d578841ee`；远端 RC 验收文档/源码可追溯后继为 `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6`，不作为 OCI revision |
| 数据库实施 | 预生产仍为 9 条 migration，第 10 条未执行；app ACL 已补齐 `OrderServicePlan INSERT/SELECT/UPDATE`，worker 仍零 DB 权限。`rcd_v2_preprod_owner.rolcanlogin=false` 已复核，既有密码状态不改变 `NOLOGIN` 阻断登录的事实；禁止重复 bootstrap 或清理 |
| Gate 3 历史验收状态 | `DEPLOYED / REAL_E2E_PASS / FAULT_ROLLBACK_PASS / FINAL_CONSISTENCY_RUNTIME_PASS`：代码、镜像、运行资源、真实 10 单和故障/回退证据一致，不适用于 Gate 4 新候选 |
| Gate 3 运行镜像（最近记录） | app/worker 为 `958afca…` → `sha256:13e0…5bff`；Nginx release revision 对齐；更早运行/回退候选继续保留，不得混用；当前健康须在下一轮重新核验 |
| 基础设施 | 阿里云主线；ECS 上 app/worker/Nginx、自签名 HTTPS、结构化日志、`json-file` 轮转与 LoongCollector `3.2.6` 已验收；SLS 运行/安全日志、查询、脱敏、30/180 天留存、告警、通知和预算通过；正式域名/备案/可信证书延后 |
| Gate 3 | `PASS`（2026-08-11 最终裁决） |
| Gate 4 子闸门 | `G4_1_TO_G4_4_PASS / G4_5_T0_PASS / T1_A_TO_T6_NOT_AUTHORIZED`；Gate 4 总闸门仍为 `IN_PROGRESS` |
| Gate 4 镜像 | 已验收远端 index `sha256:508dea2dfa25da76581adc89b33d2ccf73eb91a21af26fa8f54e08fd94fe453d`；完整 amd64/config 与扫描证据见状态总览；三个旧 RC `4102ee1… / a0c8bbd… / 857705e…` 继续 `REJECTED_DO_NOT_DEPLOY` |
| Gate 4 下一步 | 本轮输入文档基线 `ee0ab9f34d46fdb07cd5d11c415e3f723fbadfe0`；本地 `develop @ 4102ee1f85f89f363aeaa42f829a9c6d535f6d31` 未合入。冻结 T1-A 的维护窗口、责任人、观察阈值、远端路径/文件白名单和测试数据范围，再申请新鲜备份与发布准备的单独授权；不继承旧部署许可 |
| Railway | 仅历史 Demo 证据，不是生产基线 |

状态变化只认 [项目状态总览](../status/README.md)；文档入口只认 [文档版本总入口](../versions/README.md)。

Gate 3 运行证据和 G4-5 历史 T0/T1 记录保留：历史备份 `3143022530`，T1 因 SQL CRLF 在写库前阻断。当前 ECS 仍运行 Gate 3 `958afca…@sha256:13e0…5bff`；新 RC 仅通过 G4-4，未部署。T0 已确认 RDS/Tair 无公网、9/10 migration、outbox 0/0 与 ACL；写入阶段、Git 推送、migration、部署、故障演练或数据清理均未授权。

- G4-2：RDS/Tair 无公网入口；ECS 仅 80/443 公网开放，SSH 受限；自签名证书有效至 2026-10-06，仅代表预生产公网 IP 演示通过。SLS `runtime/security` 30/180 天留存与正式规则当前态已复核；临时规则 `g45-notify-test-20260906` 已触发负责人通知并关闭，未改变正式查询或阈值。
- G4-3：2026-08-30 全量快照恢复点可用；隔离恢复库完成 9→10 Forward 与 10→9 rollback，checksum、DDL 恢复和业务行数不变通过，源预生产库零写入。
- G4-4：新远端 RC `PASS`，只针对固定 digest、R55 库及验收时点库的 Critical/High 与已登记秘密扫描，不表示所有等级或未来漏洞为零。[APP-006](../versions/v2.0/application-decision-log.md#app-006gate-4-运行镜像与传递依赖安全返修例外)与[部署指南 §5.1](../versions/v2.0/deployment-guide-v2.md#51-gate-4-无-shell-运行镜像与制品验收)继续定义技术边界；其 R56 历史状态由本轮状态总览更新，不改平台架构。
- G4-5：`T0_PASS / T1_A_TO_T6_NOT_AUTHORIZED`；[主计划 §8.4.3](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md#843-g4-5-预生产继续联调方案t0-passt1t6-未授权)登记上下文、分工、证据与停止条件。恢复点 `3149081194` 状态 `Success`、`BackupAvailable=1`、类型 `FullBackup`、模式 `Automated`，完成时刻位于当前 PITR 窗口内；该自动备份只闭合 T0 盘点，不替代 T1-A 要求的另行批准新鲜备份。后续仍按准备/备份 → migration → app → 单 worker → Nginx → 真实联调逐闸门授权。

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

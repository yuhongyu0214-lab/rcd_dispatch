# 人车单 V2 Agent 公共上下文（Layer 0）

> 文档类型：`DERIVED / LAYER_0`
> 上下文版本：`RCD-AGENT-CONTEXT-20260928-R75`（A8 后已获独立 Git 提交授权；文档 SHA 以承载 R75 的本次提交为准，未推送）
> 适用范围：所有新建或重新启动的 Agent；权威范围：仅提供项目目标、当前阶段、公共纪律、模块边界和命令入口
> 非权威范围：产品行为、Schema、HTTP DTO、枚举、基础设施细节和任务验收标准
> 冲突处理：以 [文档版本总入口](../versions/README.md) 登记的领域权威为准；无法裁决时立即停止
> 使用要求：主控必须在任务单中提供代码基线、文档基线和本轮文件白名单；缺一项不得开工

## 1. 项目目标

人车单调度系统 V2 面向汽车租赁调度，主线是订单接入、实时位置、司机班次、A/B/C 工单时间轴、真实 ETA、调度事务和执行闭环。

Gate 3、第二轮、P2、3A/3B 与 Gate 4 已退出。Stage 6 现有预生产最终结论为 `STAGE6_FINAL_PASS_WITH_USER_ACCEPTANCE_EXCEPTIONS`：运行 `781a797…@sha256:82ff43b1…530b1d`，最小只读检查 17/17、独立复核通过。Safari/华为/Chrome/Edge 登录入口反馈通过；人工派单与布局沿用用户认可的历史/真机结果，注册和纯司机入口按明确用户例外接受。本轮没有剩余补测项，也没有新增成功注册或纯司机实测声明。

仓库第一批清理已完成：批准删除 208 个旧快照/预览文件，补根 README 与忽略规则；正式应用、80 个测试、10 个正向 migration 和 9 个 rollback 均保留。原限定真机范围与 iOS Safari 退出复测通过，地图/真实 ETA/GPS 不在本地验收范围。

清理提交 `0a0b9cd53bf106e3179130e7945da077fbfa3950`、R74 文档及独立测试候选 `279cc1e6d992a6bc6612a627c0f72bb70bf49988` 已合入并推送 develop。状态 `DEVELOP_MERGED_AND_PUSHED / MAIN_HANDOFF_PENDING`。独立工程与隔离运行通过：1002/7、lint/tsc、32/32 build、Prisma、HTTP 42/42 和入口代理 6/6；未新增真实浏览器/云依赖/生产容器验收。完整证据、未覆盖项、两项 P2 及推送结果见 [R75 状态总览](../status/README.md#repository-cleanup-r75)。本轮 A8 后获独立授权提交六份治理文档，不重跑业务测试、不推送，不操作 main 或服务器。

## 2. 当前版本与闸门

| 项目 | 当前事实 |
|---|---|
| 联合账号与入口代码 | 已部署验收 `781a797c3286c0a5b134a010660a0e85633216fe`；来源 `feature/v2-login-workspace-selection`，与治理 SHA 分开；当前文档工作树的基底不是运行代码 SHA |
| 一号双端本地代码 | 历史来源 `37d412c… / 463c9ee…` 已融入 `40b4a0f…`，后继登录返修为 `781a797…`；来源分支不单独部署 |
| 本轮治理与后续 | 代码/已提交文档起点 `279cc1e6d992a6bc6612a627c0f72bb70bf49988`（R74）；R75 六份治理入口已获独立提交授权；本地 develop / 文档 SHA 以承载本版本的提交为准，origin/develop 仍为 R74 起点。推送及 main 交接另行授权 |
| Gate 3 历史代码候选 | `codex/v2-gate3-app-candidate` |
| Gate 3 历史本地 SHA | `958afca537b412fb972b6e180561a9b37022834d` |
| Gate 3 历史远程 SHA | `958afca537b412fb972b6e180561a9b37022834d`，已完成普通快进推送与远端核验 |
| Gate 3 历史文档基线 | `PASS` 内容基线 `feature/v2-gate3-review-remediation @ 464ee5d6ffdb435d76b65f9814d82e4666fd84a9`，本地/upstream/GitHub 远程一致 |
| Gate 3→develop | 交接分支 `b853a7af245942758de1cd46c9a25c384c08ec62`；代码交接合并点 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`，本地/upstream/GitHub 远程一致 |
| 第二轮与 P2 退出基线 | 2A/2B/2C 代码树锚点 `46813c3ecf4a0df1eaf99bfb3d8d72f7d450193b`；P2 候选 `0e354696…` 已合入 `develop @ 5c2760cea40b975b24d5d2201333ab5048ce1cf0`，合并父提交为 `78a708f…` 与 `0e354696…` |
| Gate 4 历史代码 | `feature/v2-stabilization @ 4d370d664c3710a4a03cb1b665cfdeddc7d32778`；应用 tree `5188c0efcb96d646a9609b7c47dd624d578841ee`；远端 RC 验收文档/源码可追溯后继为 `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6`，不作为 OCI revision |
| 数据库实施 | 预生产已由 9 条增至 10 条 migration，outbox CHECK 精确允许 17 种事件；app ACL 含 `OrderServicePlan INSERT/SELECT/UPDATE`，worker 零 DB 权限。`rcd_v2_preprod_owner.rolcanlogin=false` 保持；migration 绝对时间缺失已获一次性非阻断裁决，禁止重跑、改元数据或重开 owner 补证 |
| Gate 3 历史验收状态 | `DEPLOYED / REAL_E2E_PASS / FAULT_ROLLBACK_PASS / FINAL_CONSISTENCY_RUNTIME_PASS`：代码、镜像、运行资源、真实 10 单和故障/回退证据一致，不适用于 Gate 4 新候选 |
| Gate 3 运行镜像（最近记录） | app/worker 为 `958afca…` → `sha256:13e0…5bff`；Nginx release revision 对齐；更早运行/回退候选继续保留，不得混用；当前健康须在下一轮重新核验 |
| 基础设施 | 阿里云预生产现有 ECS/RDS/Tair/ACR/SLS 架构继续使用；可信 IP HTTPS health/login、当前版本 SLS 采集查询已核验；正式生产域名、备案和发布仍独立 |
| Gate 3 | `PASS`（2026-08-11 最终裁决） |
| Gate 4 子闸门 | `G4_1_TO_G4_4_PASS / G4_5_FINAL_PASS_WITH_CONTROLLER_EXCEPTION`；Gate 4 总闸门 `PASS` |
| Gate 4 镜像 | 已验收远端 index `sha256:508dea2dfa25da76581adc89b33d2ccf73eb91a21af26fa8f54e08fd94fe453d`；完整 amd64/config 与扫描证据见状态总览；三个旧 RC `4102ee1… / a0c8bbd… / 857705e…` 继续 `REJECTED_DO_NOT_DEPLOY` |
| post-Gate-4 预生产返修 | `b2887d3…` 为历史部署；当前 `781a797…@sha256:82ff43b1…530b1d`，app/worker healthy、单 worker、Nginx running，Stage 6 未执行 migration |
| 主线与下一步 | 本地 develop 为承载 R75 的本次文档提交，已推送 origin/develop `279cc1e6d992a6bc6612a627c0f72bb70bf49988`；main/origin/main `c523fccd7febb06ac15ea379e57e06110aa1ec69`（远端确认时间 2026-09-28T01:00:00.5484224Z）。正式应用 tree 同为 `a2b5de446fe59119557db77b62011697a0539961`，亦与运行源码 781a797 一致。main 清理晋级待办，不删分支、不重写历史、不改服务器 |
| Railway | 仅历史 Demo 证据，不是生产基线 |

状态变化只认 [项目状态总览](../status/README.md)，领域与角色入口只认 [文档版本总入口](../versions/README.md)。上述 Gate 3/Gate 4 表项均为历史记录，不能当成当前运行身份；最新运行/例外详见 [Stage 6 最终验收记录](../status/2026-09-27-stage6-final-acceptance.md)。

最终只读报告 SHA-256 `4ff3105af777e687612cca6e036b24105fd325c975b4a4da1c9117d6a75c827e`；收口证据 ZIP SHA-256 `6268930bf969ef589aa12afa7b670710d411195dad171109d1e526a4f6c0a502`。采集器的原始 false 由独立最终裁决解释，不覆盖原始结果。已接受的 P2 与证据边界继续保留。

正式生产 T0 的旧 R72 任务卡已经是历史输入，不能直接启动新执行。未来任务须重新冻结代码、文档、镜像与范围；购买、备案提交、云资源/配置、migration、部署和生产数据访问需另行授权。生产 RDS、Tair、账号、秘密与数据不复用预生产。

大白话：清理版已上传 GitHub 的 develop，main 还没纳入这次清理；项目档案独立提交留在本地，线上应用没有变化。

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

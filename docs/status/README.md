# 人车单项目状态总览

> 状态快照：2026-09-06 / R60
> 用途：说明项目做到哪一步、还差什么
> 非权威范围：产品行为、状态机、Schema、枚举、HTTP 契约、技术栈和生产架构

## 一句话结论

Gate 3、第二轮、P2 与 3A/3B 已退出，G4-1～G4-4 保持 PASS。G4-5 新一轮 T0 已 `PASS`：ECS、RDS、Tair、网络、旧运行身份、9/10 migration、备份策略、逐表权限、owner `NOLOGIN`、SLS 通知链路与当前恢复点均已重新核对；`OrderServicePlan` 的 app 最小写权限经单独返修与独立复核闭合。最新可用全量自动备份 `3149081194` 成功完成于 `2026-09-06T07:06:43Z`，完成时刻位于 `2026-08-31T07:07:02Z .. 2026-09-06T09:24:50Z` 的 PITR 窗口内。新 RC `4d370d6…@sha256:508dea…453d` 尚未部署，Gate 4 总闸门仍 `IN_PROGRESS`；T1-A～T6 均未授权。

## 当前工作流状态

| 工作流 | 状态 | 证据/入口 | 下一闸门 |
|---|---|---|---|
| 文档治理 | `G4_5_T0_PASS_EVIDENCE_SYNC` | 本轮输入文档 SHA `ee0ab9f34d46fdb07cd5d11c415e3f723fbadfe0`；代码 `4d370d6…` 不变 | R60 仅同步 5 份治理文档，未获 Git 提交或推送授权 |
| 应用候选 | `958AFCA_GATE3_ACCEPTED_DEVELOP_HANDOFF_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变运行身份；代码历史交接点为 `develop @ 51ddb5f…`，最终状态激活 HEAD 为 `ae471484…` |
| 依赖安全 | `REMOTE_DUAL_DB_CRITICAL_HIGH_0 / SECRET_0 / INDEPENDENT_AUDIT_PASS` | 同一远端 amd64 `sha256:577dc2…f414`，R55 与 2026-09-03 验收时点当前库两组扫描均通过 | 仅固定镜像/库/严重等级成立；若联调延后或出现新披露，先复核扫描有效性 |
| migration 指纹 | `PREPROD_9_APPLIED_EXACT / 10_PENDING` | 9 条 `_prisma_migrations` 名称与 checksum 复核一致；现有 outbox CHECK 仅 15 种事件 | 第 10 条未实施；未经 T1-B 单独授权不得执行 |
| 数据库迁移 | `OUTBOX_CHECK_REMEDIATION_PASS_LOCAL_DEVELOP` | 两个新事件 CHECK、受保护 rollback、零漂移和全量回归通过 | 数据分支退出；API 分支重放新基线后使用该约束，禁止重复迁移 |
| 隔离业务基础资料 | `BASE_DATA_PASS_TEST_FACTS_RETAINED` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 不重复基础资料写入；所有通过与失败样本均保留 |
| 基础设施文档 | `GATE3_FINAL_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | Gate 3-R 退出；正式可信 HTTPS 与整机/RDS 灾备仍为独立后续验收 |
| ACR 镜像发布 | `REMOTE_RC_ACCEPTANCE_COMPLETE / G4_4_PASS` | `4d370d6…` → index `sha256:508dea…453d`；完整身份及哈希见下节 | 三个旧 RC 保持拒绝；新 RC 未部署，必须由 G4-5 新任务卡按 digest 使用 |
| 阿里云预生产准备 | `G4_5_T0_PASS / T1_A_NOT_AUTHORIZED` | 2026-09-06 ECS/RDS/Tair/网络/运行身份/数据库权限、owner `NOLOGIN`、SLS 通知与 RDS 恢复点重新核验；详见本页 T0 记录 | 冻结 T1-A 参数并取得单独授权后才能进行发布准备 |
| 本地 Docker Desktop | `DATA_MOVED_TO_D_NTFS_BACKUP_RETAINED` | `D:\DockerDesktop\data\DockerDesktopWSL` | 镜像、版本、容器与卷核验通过；完整 VHDX 备份保留，不影响生产架构 |
| 既有预生产成果审查 | `RUNTIME_FINAL_CONSISTENCY_PASS` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 保持备份、9 个 migration、最小权限、单 worker 和运行身份不变 |
| 真实 10 单 | `REAL10_PASS_9_COMPLETED_1_INFEASIBLE_ALERT` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 保留全部成功与失败现场，不清理 |
| Gate 3 总闸门 | `PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变候选与证据，进入受控阶段交接 |
| 串行调度员 V2 API 接线 | `T1_PASS / MERGED_LOCAL / POST_MERGE_PASS` | 候选 `152f7c5…` 已合入 `develop @ 8cfed6ad…`；T1 与合并后全量回归通过 | 串行前置退出；保持本地合并且暂不推送 |
| 第二轮并行 | `MERGED_LOCAL / POST_MERGE_PASS / P2_EXIT_PASS` | P2 候选 `0e354696…` 已合入 `develop @ 5c2760c…` | 第二轮退出；进入 3A/3B 并行验证前置 |
| 并行验证 3A/3B | `PASS_WARN / GATE4_ENTRY_COMPLETE` | 3A migration/兼容/rollback/零漂移通过；3B PRD 14 项、故障、API、数据库和浏览器通过 | 已进入 Gate 4；继续保留 Edge 等效布局警告，不得写成原生 125% 证据 |
| Gate 4 T0/G4-1 | `PASS` | `feature/v2-stabilization @ 4102ee1…` 初始基线干净；全量 test/lint/tsc/build/Prisma validate 通过 | 结果已作为后续 Gate 4 子阶段入口 |
| Gate 4 G4-2 | `PASS` | ACR、ECS、RDS、Tair、SLS、Nginx、自签名证书、安全组、责任人和网络边界已只读核验 | 未误用生产资源；无需开放公网数据库或 Redis |
| Gate 4 G4-3 | `PASS` | 2026-08-30 全量快照恢复点可用；隔离恢复库完成 9→10 migration Forward 与 10→9 rollback | 源预生产库零写入；隔离恢复库保留，后续清理由单独授权处理 |
| Gate 4 G4-4 | `PASS / REMOTE_RC_ACCEPTANCE_COMPLETE` | 新远端 `4d370d6…` 的身份、SQL、工程/运行探针、双库/秘密扫描及独立审计通过 | 主控裁决只针对本节完整 digest；不是部署或 Gate 4 总闸门 PASS |
| Gate 4 G4-5 | `T0_PASS / T1_A_TO_T6_NOT_AUTHORIZED` | 新 RC 已通过且未部署；当前预生产仍运行 Gate 3 revision，数据库仍为 9 条 migration；恢复点证据已闭合 | 先冻结并单独批准 T1-A，再逐项申请 T1-B～T6；不得部署或迁移 |
| Gate 4 总闸门 | `IN_PROGRESS` | G4-1～G4-4 已通过，G4-5 尚待新任务执行与验收 | 不自动合并 develop、推送、进入 main 或宣布正式生产上线 |

## 3A/3B 退出记录

当前 Gate 4 筹备来源为 `develop @ f835302d555fc0481a37dfc388bf8e4e382a6230`；其父提交及应用代码树锚点为 `8ff70cccf29371229818058055d45de376eebdf7`，相对父提交只修改 5 份治理文档。T0 合并提交的代码树与已验收候选 `72cb11baad851f3a2fc2bf1ea6367affac679c96` 完全相同；3B worktree 已快进到应用树锚点且保持干净。

| 验证线 | 角色、分支与 worktree | 退出状态 | 隔离与外部边界 | 已达成 |
|---|---|---|---|---|
| 3A | 数据库验证 Agent；`feature/v2-migration-validation`；`.worktrees/v2-migration-validation` | `PASS / WARN` | PostgreSQL 18.3 `127.0.0.1:55437`；无真实外部系统 | 10 个 migration、V1/V2 映射、兼容窗口、数据核对、rollback 保护/安全回退和 Schema 零漂移均通过；T0 的 7 文件差异未触及 Schema、migration 或兼容域 |
| 3B | 测试 Agent；`feature/v2-e2e-validation @ 8ff70ccc…`；`.worktrees/v2-e2e-validation` | `PASS / WARN` | PostgreSQL 18.3 `127.0.0.1:55438`、app `3048`、Mock `3049`；均已清理，无外部授权 | PRD §13 14 项、并发幂等、故障、数据库/API、安全、Chrome 与 Edge 均通过；Edge 125% 仅为 `952×800` 等效布局证据 |

以上 3A/3B 是 Gate 4 的历史入口证据。Gate 4 已在独立分支/worktree 启动，且不得继承 3A/3B 的临时端口、fixture、Mock 或数据库授权。

## Gate 4 进度记录

| 子阶段 | 状态 | 可复核证据 | 边界与剩余项 |
|---|---|---|---|
| T0/G4-1 工程与验收基线 | `PASS` | 初始统一基线 `4102ee1f85f89f363aeaa42f829a9c6d535f6d31`；依赖只借用一致锁定目录；全量 `812 passed / 7 expected skipped`、lint、`tsc --noEmit`、build、Prisma validate 和 diff check 通过，最终工作区干净 | 未修复业务代码、未连接外部系统 |
| G4-2 资源与权限盘点 | `PASS` | RDS 公网地址关闭，白名单含 `127.0.0.1`、既有 `dev` 记录及预生产 ECS 内网 `172.22.124.231/32`；Tair 公网访问未申请，白名单含系统项及同一 ECS 内网地址。ECS 仅 80/443 公网开放，SSH 受限；ACR、SLS runtime/security、Nginx、自签名证书、安全组和责任人已确认 | RDS 既有 `dev` 白名单在无公网地址时不可达，但仍登记为最小化治理债务；RDS/Tair 页面未配置预生产标签；ACR 个人版无生产 SLA，只允许当前开发/预生产候选 |
| G4-2 SLS/证书补齐 | `PASS` | SLS 告警中心已初始化，两条规则运行；runtime 保留 30 天、security 保留 180 天。自签名证书轮换后 `NOT_AFTER=2026-10-06`、指纹 `47:DA:50:4B:81:E9:7F:C1:92:12:A1:5E:F0:6B:EE:40:FE:98:5E:0E:E1:1F:A2:32:C1:19:F2:D6:CA:06:CA:32`，Nginx test/reload 与 HTTP 308、HTTPS 登录/健康 200 通过 | 自签名仅获准用于预生产公网 IP 演示，不代表可信证书或正式生产 HTTPS 通过 |
| G4-3 恢复点与隔离迁移回退 | `PASS` | 2026-08-30 15:44:53 全量快照备份完成；隔离库 `rcd_v2_g43_restore_20260830` 从 9 个已匹配 checksum 的 migration 正向到 10 个，再按批准 rollback 与单条元数据复位回到 9 个。正向后目标约束存在，回退后 DDL 指纹恢复，业务行数指纹始终 `bdfd523e37095ee55ed03daa94e454e4c92fac910a16c3d21d3d1ddb836c9828` | `UNEXPECTED_DDL=NONE`、`BUSINESS_DATA_DELETION=NONE`、源预生产库写入为零；不把隔离库操作写成生产迁移 |
| G4-4 首个 RC 安全扫描 | `REJECTED_DO_NOT_DEPLOY` | SHA tag `4102ee1…`，index digest `sha256:5d9685bd49b4404dea4e04be0c4b009d3746e9fdb0325665a87e8b66e4024d30`，amd64 digest `sha256:c41161d0d03581612c0edaf2aeb800649215bd9eae883dc9f8fa815067c9f388`；扫描发现未裁决 Critical/High，根因包含完整开发期 `node_modules` 进入最终镜像 | 禁止覆盖、删除或部署；作为失败证据保留 |
| G4-4 本地返修与审计 | `PASS / HISTORICAL_LOCAL_STAGE` | 返修提交 `5f5104f…`、`c3b554e…` 仅修改 4 个批准文件；应用目录 tree `d5443715affdf7f4c6ff8d3013f1e91515deb54a`。本地 amd64 manifest `sha256:bcee2149a8b0b8825a2556db809ccf8f5b933adaf6892bfbd36de81ff100c4c9`，OCI revision=`c3b554e…`；Trivy 0.74.0 报告 SHA-256 `dc54d00c8dd9aaccbc331c5b182c7222fa514c009c98ca24721a12a58d78ae13`，未解决 P0/P1 为 0，独立代码审计通过 | 本地镜像使用显式占位高德构建参数且不可部署；随后形成的远端正式 RC 结果见下一行 |
| G4-4 历史远端 RC 追溯与复扫 | `SUPERSEDED_BY_ARTIFACT_PREFLIGHT_FAIL / REJECTED_DO_NOT_DEPLOY` | source/tag/OCI revision `a0c8bbdc…`，index `sha256:8e671d…c541`，amd64 `sha256:de3bb4…d913`，Trivy 与同 digest 曾通过；但 G4-5 T1 证明镜像内第 10 条 SQL raw SHA 为 CRLF 的 `4944d45a972d68d20a67708457ed733f6e00b4fbc1f72cb5acab8a05c6d1a2d7`，与正式 `ab2fd94d…` 不一致 | 与 `4102ee1…` RC 一样保留为失败证据，禁止覆盖、删除或部署 |
| G4-4 CRLF 制品本地返修 | `PASS / HISTORICAL_LOCAL_STAGE` | 提交 `0c854224c703b3afaa18db2351d8bba3b263ad86` 只修改 `.gitattributes`、Dockerfile 和部署制品测试；专项 5/5、全量 `813 passed / 7 expected skipped`、lint、tsc、31/31 build、diff check 通过；本地镜像 `sha256:9c771dd5ba19db1babdccbfc94ee804d7e29e77d4fdfa5537028af4d56e15c41` 内残余 CR=0、19/19 SQL raw SHA 与 Git 一致，独立审计 P0/P1/P2=0 | 已进入后续统一远端基线；远端 RC 结果见下一行 |
| G4-4 统一远端 RC 追溯与扫描 | `TRACEABILITY_PASS / SECURITY_SCAN_FAIL / REJECTED_DO_NOT_DEPLOY` | source/tag/OCI revision `857705e810172a1e53eb1355089d51a3ad8c7632`；index `sha256:79c72cc67ecf718d8ddb54e562c52c325424ce55868a3d1d79a67b0de81b9823`；amd64 `sha256:55c444089ba7986c4cef3a41f4a9f6509cd05f3d8f55d7e39c1e9c1236cee530`；config `sha256:3729cd702a4748dcc76024cbd9f2d6ff4959f118a995c38fa9699d85caac13d8`；linux/amd64、10 个 migration、19/19 raw SQL、残余 CR=0、Compose app/worker/migration 同 index digest、无 `latest` 均通过。Trivy 0.74.0 报告 SHA-256 `5fc07d3d33d83421d46ddc66c7c7b199ca24b7cad8c44f08511429de602c038e`，数据库更新时间 `2026-09-01T13:14:56.115397541Z`；未裁决 P0=2、P1=10。秘密扫描 SHA-256 `e62b426e6092e3a3256604957a18f7cc2c4ed8e7b1276d244a9af4027aa732bf`，发现 0 项 | 独立审计 `FAIL`；禁止覆盖、删除或部署。证据目录 `g44-857705e-79c72cc-20260901T155242Z`，补充审计 `supplemental-audit-20260901T161235Z`。证据限制：未持久化首次构建前 tag 不存在的原始证明、无全程不可变 shell transcript、未形成独立 ECS 非部署快照；本地 Docker 事件未见业务容器启动，这些限制不改变 `FAIL` 结论 |
| G4-5 历史发布尝试 | `HISTORICAL_T0_PASS / T1_ARTIFACT_PREFLIGHT_FAIL` | 历史 T0：app/worker/Nginx 为 Gate 3 `958afca…`，真实依赖、单 worker、outbox 0/0、9 条 migration 通过；RDS 备份 `3143022530`，ECS 配置备份 SHA-256 `9feec1ab82cec72dc995a10e8b06f84a5014ab81e480c1a46bae6a38ded3525b` | T1 写库前阻断，未更新业务容器；记录不可改写。新 RC G4-4 已通过，但旧授权/备份有效性不能直接继承 |
| G4-5 当前 T0 只读盘点 | `PASS / RECOVERY_POINT_EVIDENCE_PASS` | ECS、RDS、Tair、网络、旧运行身份、9 条 migration、outbox、最小权限、owner `NOLOGIN`、SLS 通知及恢复点已核验；app ACL 返修独立复核 PASS | T1-A 参数未冻结且未获授权，不得启动 |

## Gate 4 本地安全返修证据（2026-09-03）

本节为 R56 本地阶段历史记录；后续远端与当前主控状态见下节，不把历史“未推送”误作当前事实。

主控已读取本轮审计报告并核对 Git SHA、父基线、五文件边界、干净工作区、应用 tree 与扫描报告哈希；本次文档同步没有重跑工程测试、构建或 Trivy。以下是已完成的本地返修及独立复审证据，不是远端/部署事实。

| 项目 | 固定证据 |
|---|---|
| 代码候选 | `4d370d664c3710a4a03cb1b665cfdeddc7d32778` |
| 父提交 / R55 文档基线 | `c5e38e42af82a4fb144e93170cc5d4c9001f5a74`；后续 R56 七文档提交为 `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6` |
| 应用 tree | `5188c0efcb96d646a9609b7c47dd624d578841ee` |
| 五文件边界 | `feature-admin-workflow/` 下 Dockerfile、deploy/compose.preprod.yml、package.json、pnpm-lock.yaml、scripts/deployment-artifacts.test.mjs；+43/-45，无业务/API/Schema/SQL 修改 |
| Git 归档 SHA-256 | `4e5ca87c7df2303e1bf665e35e7a253cdf046cf7fdb91865d47e7ad7de8be5d9` |
| 本地 tag | `rcd-dispatch:security-remediation-4d370d664c3710a4a03cb1b665cfdeddc7d32778`；构建前不存在的证据已保留 |
| 本地 index digest | `sha256:22c46f4c0f064260da51e25f3f4233f2d39ecbb73dc09d48166a7af800349da8` |
| 本地 amd64 manifest | `sha256:f66800a9e22177a88aa2384f50c4a7eaea1826cb56636022aca8b648f89543db` |
| 本地 config / ImageID | `sha256:6ad3219d0544a98f1a500faeb6b046c930ad43905ae448927e74ae96f64db56d`；OCI revision 等于候选完整 SHA |
| image.tar SHA-256 | `437e9d31d51daf78c273e87771d2bd3940e3d606265f7167b3f75ab6267cf902` |
| Scanner | Trivy `0.74.0`；`ghcr.io/aquasecurity/trivy@sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9` |
| 固定 R55 库 | UpdatedAt=`2026-09-01T13:14:56.115397541Z`；SHA-256=`ca87a559f6180df49b3fbb565953dac622be06b9e552ce6154d6c7863556600e`；扫描前后未变 |
| 扫描结果与范围 | OS + library，14 个 Debian 包、90 个 Node 包；Critical=0、High=0；未 ignore-unfixed、未使用漏洞例外；不声称其他等级或最新库为零 |
| Trivy 报告 SHA-256 | `c3bf30b87438b62ff5eff978fb7d0c44f483f162a7174f10e73ce6adcdb49c21` |
| 运行 / SQL | Node 22.23.2、UID/GID 65532:65532；bcrypt、Prisma 6.19.3、worker 心跳和 app 健康通过；setuid/setgid/mount/umount 均为 0；19/19 SQL raw SHA 相同、CR=0，未执行迁移 |
| 工程 / 复审 | 全量 813 passed / 7 expected skipped / 0 failed；专项 5/5、lint、TypeScript、diff check PASS；最后独立复审未重复生产构建，复用了既有 31/31 日志和实际镜像 |
| 清理与边界 | 临时探针/导出/扫描容器已移除，镜像和证据保留；未 Git/ACR 推送，未连接真实依赖或部署；Gate 4 worktree 在同步文档前干净 |

证据目录：`C:/Users/yhy/AppData/Local/Temp/g44-security-4d370d6-20260903/`，含 `audit-result.md`、`trivy-report.json`、`build.log` 和镜像/运行探针。Temp 路径不是长期证据仓库；保留原件及哈希，后续归档不得覆盖或删除失败证据。

R56 历史后续要求及完成情况：

- 已批准运行例外见[APP-006](../versions/v2.0/application-decision-log.md#app-006gate-4-运行镜像与传递依赖安全返修例外)与[部署指南 §5.1](../versions/v2.0/deployment-guide-v2.md#51-gate-4-无-shell-运行镜像与制品验收)，不改变阿里云主线或三角色同镜像。
- 七文档已提交为 `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6`，随后新远端任务获得单独授权并完成；代码锚点与文档 SHA 分开登记。
- 真实浏览器构建配置制品的 source/tag/digest、SQL、运行探针、秘密扫描、固定 R55 库与验收时点当前库复验已完成，详见下节；未将占位镜像改名冒充正式 RC。
- 三个旧 RC 及失败结论保留；新 G4-4 已获主控 PASS，但旧 SHA/digest 的 G4-5 部署授权不能继承。

## Gate 4 新远端 RC 正式验收与主控裁决（2026-09-03）

**2026-09-03 历史裁决：G4-4 PASS；当时 G4-5 仅 ENTRY_READY。** 独立证据审计 PASS，未决 P0/P1/P2 均为 0；不是 Gate 4 总闸门 PASS，也不是预生产部署完成。2026-09-05 的 G4-5 T0 当前结论以本页后续“T0 当前只读盘点”一节为准。

| 身份 | 已验收的精确值 |
|---|---|
| 代码 / RC tag / OCI revision | `4d370d664c3710a4a03cb1b665cfdeddc7d32778` |
| 远端验收文档基线 / 可追溯源码后继 | `7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6`；本地 origin 跟踪同值，代码锚点为其祖先 |
| 新 R57 文档基线 | 本次五文档治理提交，完整 SHA 由主控提交回执下发；不替换上述代码/镜像身份 |
| 仓库 | `crpi-kcg4tksk7neseyy4.cn-shanghai.personal.cr.aliyuncs.com/rcd_dispatch/rcd_dispatch` |
| OCI index digest | `sha256:508dea2dfa25da76581adc89b33d2ccf73eb91a21af26fa8f54e08fd94fe453d` |
| linux/amd64 manifest digest | `sha256:577dc21e8375d1ff07af4e49100799ac6ba1b1b225968e91f3559091bc04f414` |
| config digest | `sha256:2930e8be2941a59fada8f8bef9614e95b83445c58e70a2f7b1337741baed8649` |
| 应用 tree / Git 归档 SHA-256 | `5188c0efcb96d646a9609b7c47dd624d578841ee` / `4e5ca87c7df2303e1bf665e35e7a253cdf046cf7fdb91865d47e7ad7de8be5d9` |
| 制品与工程 | 813 passed / 7 expected skipped、lint、tsc、31/31 build、Prisma validate、专项 5/5；19/19 SQL raw SHA 与归档一致、CR=0；非 root、bcrypt/Prisma CLI、隔离 app/worker 探针通过 |
| 三角色与安全 | Compose config 验证 app/worker/migration 共用上述 index；真实浏览器公开构建参数已使用；无 latest、shell、开发工具、setuid/setgid/mount/umount；没有运行真实业务容器或 migration |

**扫描限定。** 固定 Trivy 0.74.0（scanner digest 沿用上节）对远端同一 amd64 制品执行 OS + library 两组扫描，覆盖 14 个 OS 包、90 个 Node 包；两组 Critical=0、High=0，未使用 ignore-unfixed、例外过滤或可达性豁免。秘密扫描发现 0 项。不宣称其他严重等级、未来漏洞库或所有潜在漏洞为零。

| 扫描证据 | 更新时间 / SHA-256 |
|---|---|
| R55 固定库 | `2026-09-01T13:14:56.115397541Z` / `ca87a559f6180df49b3fbb565953dac622be06b9e552ce6154d6c7863556600e` |
| 验收时点当前库 | `2026-09-03T01:14:45.115995799Z` / `13f48e8b37a9067a620a2bb641eca947619c9ff642384188d4d8e8f419221189` |
| R55 报告 | `94d15f22efeeb50e946ce6f39c8d4c3213b6faa6550a8b60004fb056ab029218` |
| 当前库报告 | `d55a799c328748cc75b6151952c1b9990567f2367c02ed880931c2a2a85656f4` |
| 秘密扫描报告 | `4d155eab9adf664d52886fff6d55919a4249c9a27441ff012f14603565d4c28b` |

**原始记录与证据限制。** 目录 `C:/Users/yhy/AppData/Local/Temp/g44-remote-4d370d6-20260903T110828/`；`acceptance-record.md` SHA-256 为 `0ed1814ebddc3b79d3b8d45318c51312dc780fce4facaa906b66994e04bc94aa`，`independent-audit.md` 为 `30850edde661b7b174ce60f458817c8ce1d59eb6bcd59d8cb42569036b79b776`，`evidence-files.sha256` 为 `1fbb930a994e79d03086552ef3b98a7dab846c521f0a4aba1bd209de77b0b5a5`（63/63 文件哈希复核通过）。审计独立复算归档、OCI、SQL、扫描/数据库和文件哈希；“未部署/清理”来自执行记录，不是本轮 ECS 实时快照。Temp 不是长期档案，原件和失败证据必须保留，迁移到受控证据目录后才能另行裁决清理。

**公开配置记录事件已闭合。** 初次构建 metadata 曾记录两项获准的浏览器公开参数，发现后阻断并仅脱敏 metadata，留存脱敏前/后哈希及回执；最终报告/脚本/日志复扫该两值均为 0，镜像身份未改变。未发现服务端 Key、数据库或云密钥泄漏证据；不得改写成“从未记录公开配置”。

**下一步与权限。** 本轮仅更新五份治理文档，不提交、不推送、不合并 develop；API、数据和基建权威正文不变。G4-5 T0 只读盘点已经 PASS，结论见下一节。T1-A 的新鲜备份/配置准备、migration、app、单 worker、Nginx、真实测试数据、告警测试与后续故障/回退演练仍须对应单独授权；旧 SHA/digest 任务卡失效，三个拒绝 RC 继续保留。

## G4-5 T0 当前只读盘点与 ACL 返修记录（2026-09-06）

**阶段结论：`T0_PASS / RECOVERY_POINT_EVIDENCE_PASS / T1_A_TO_T6_NOT_AUTHORIZED`。** 本节只登记已取得的控制台、ECS、数据库、通知与恢复点证据；不把历史 G4-2/G4-3 结果自动续期，也不授权 T1-A 或任何部署/迁移。

| 域 | 已核验事实 | 当前裁决 |
|---|---|---|
| ECS / 网络 | 实例 `i-uf6bikdzvy9elknkt337`，上海 E，公网 `101.133.147.166`、私网 `172.22.124.231`；2 vCPU/2 GiB/40 GiB，约 19 GiB 可用；到期 `2026-10-02 23:59:59`。安全组仅 80/443 对公网，22 仅 Workbench 网段和登记运维 IP；3000/5432/6379 未公网开放 | `PASS`；续费与安全组变更不在本轮授权内 |
| 当前运行身份 | app/worker 仍运行 Gate 3 index `sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`，revision `958afca537b412fb972b6e180561a9b37022834d`，健康且零重启；Nginx revision 对齐旧运行身份。新 RC 尚未部署 | `PASS / EXPECTED_OLD_RUNTIME`；不得冒充 Gate 4 已运行 |
| RDS / Tair | RDS `pgm-uf607246o2m33889`、PostgreSQL 15、库 `rcd_v2_preprod`，仅 VPC 地址 `172.22.124.229:5432`；Tair `r-uf6335ahg11o3pbj4n`、Redis 7，仅 VPC 地址 `172.22.124.230:6379`；均无公网连接地址 | `PASS` |
| migration / outbox | 9 条 migration 名称、checksum、finished/rolled_back 与冻结记录一致；第 10 条 `20260816120000_extend_dispatch_event_outbox_types` 未应用。现有 outbox CHECK 精确 15 种事件；快照总数 4428、pending=0、failed=0 | `PASS / 10_PENDING`；T1-B 前不得写库 |
| 数据库角色 | app/owner/worker 均非 superuser、无 createdb/createrole/replication/bypassrls；15 张表 owner 均为 `rcd_v2_preprod_owner`。worker 无数据库 CONNECT、schema 或逐表权限；app 无数据库/schema 创建、TEMP、DELETE 和 migration 元数据权限。用户以 `dispatch_admin` 执行 `ALTER ROLE rcd_v2_preprod_owner NOLOGIN` 后复核 `rolcanlogin=false`；密码状态为 `SET_OR_MASKED`，但不能绕过 `NOLOGIN` | `PASS / OWNER_LOGIN_CLOSED` |
| app ACL 返修 | `OrderServicePlan` 由只读修正为 `INSERT,SELECT,UPDATE`；其余 29 个 role-table 对照项不变，所有 grant option 为 NONE，worker 仍全部 NONE。单独返修与独立只读复核通过 | `PASS`；不是 migration，也未改业务数据 |
| SLS 当前态与通知 | Project `rcd-v2-preprod-sh-uf6b` 的 `runtime/security`、正式 SSH/worker 告警和 30/180 天留存复核通过。临时规则 `g45-notify-test-20260906`（ID `alert-1788680239-997911`）以中级告警触发负责人通知；首次触发 `2026-09-06 15:37:21`，评估触发 `17:00:53`，实例 `a4095983558904d3-65accbd1feaaa-20a63b9`；随后已关闭 | `PASS / TEST_RULE_CLOSED`；不改变正式查询、阈值或主通知决策 |
| 备份与证书 | RDS 每日全量快照 15:00–16:00、保留 7 天；日志备份开启并保留 7 天。最新可用恢复点为 BackupId `3149081194`，`Success / BackupAvailable=1 / FullBackup / Automated`，完成于 `2026-09-06T07:06:43Z`（上海时间 15:06:43）；PITR 窗口为 `2026-08-31T07:07:02Z .. 2026-09-06T09:24:50Z`（上海时间 8 月 31 日 15:07:02 至 9 月 6 日 17:24:50）。自签名 IP SAN 证书有效至 2026-10-06，仅用于预生产公网 IP 演示 | `PASS / RECOVERY_POINT_AVAILABLE`；自动备份只闭合 T0，不替代 T1-A 单独批准的新鲜备份 |

ACL 复核原始文本位于 `C:/Users/yhy/.codex/attachments/07595ab1-14f4-4ca5-94f2-76498efce68f/pasted-text.txt`，SHA-256 为 `2b79fe4aea47974ab1382138314e533c6bdd010ea9205b992fc3aa938cb06d35`。该附件不是长期证据库，迁移前不得删除原件。

恢复点证据来源为用户回传的阿里云只读命令输出：BackupId `3149081194`、完成时间 `2026-09-06T07:06:43Z`、当前 PITR 窗口 `2026-08-31T07:07:02Z .. 2026-09-06T09:24:50Z`，并同时返回 `Success`、`BackupAvailable=1`、`FullBackup`、`Automated`。完成时刻落在窗口内，因此主控将 T0 恢复点项裁决为 PASS；未取得命令请求 ID，不扩大写成独立 API 复核。

进入 T1-A 前仍必须冻结维护起止/最长停机、实名负责人及替补、升级联系方式、观察时长与阈值、精确远端目录/文件白名单及测试数据范围，并对新鲜备份、配置备份、按 digest 拉取、受限配置/秘密注入和必要流量控制取得单独授权。

## 代码、文档与迁移基线（按阶段区分）

```text
branch: codex/v2-gate3-app-candidate
local commit: 958afca537b412fb972b6e180561a9b37022834d
remote commit: 958afca537b412fb972b6e180561a9b37022834d
migration count: 9
forward-manifest sha256: a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d
all-sql aggregate sha256: b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f
previous runtime image tag: 7595a649e166e78bc4936d16e84e478bbc659309
previous runtime image digest: sha256:2734a7fe5d96744523f71ab73a3d5efc74643099501489ccf0845808dd6f5844
earlier runtime image tag: 4eb3b4857caae9730eb70dd9f2fb152bd8972ca0
earlier runtime image digest: sha256:9ec8265b971453edd73bc4e0ea882c3d8665ed46beabf78756d03409e80c962f
rollback image tag: 084649f498c7bce3c1418c2a5d9273282b085efc
rollback image digest: sha256:4664fc50cbd1a6bf08e24e99447d2f03097e3d21a74fcdaa80d2c2c432b05947
migration-era candidate image tag: 492c86ea51b40da9426b8ad5b6aef861aa429ab5
migration-era candidate image digest: sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d
superseded non-runtime candidate tag: 08d84cfc6624dc1e29f24b75f715550718067fb1
superseded non-runtime candidate digest: sha256:04ea40c46cfa7eb6f6bd6a08b3bc2d74d547efcf0ab296bd641f3bd3f2ac1376
current candidate/runtime image tag: 958afca537b412fb972b6e180561a9b37022834d
current candidate/runtime image index digest: sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff
current amd64 manifest digest: sha256:04798acbaa142e97b5bc2cdba85d3852e5c0261da9a3368c9c6ba73e24127f87
document baseline branch: feature/v2-gate3-review-remediation
document baseline commit: 57ef86c43bf220f48774e130575c40b8c94a83d5
document status activation commit: 3ee8cfc6f5b7706a193172f67f27e98056d9e9fe
gate3 pass document content baseline commit: 464ee5d6ffdb435d76b65f9814d82e4666fd84a9
gate3 develop handoff branch commit: b853a7af245942758de1cd46c9a25c384c08ec62
gate3 code handoff develop merge: 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e
round2 freeze source: local develop @ f90bac6ec5f80abff33635cab4b23c0f86795086
round2 frozen contract source: local develop @ 117653e55ac69a8e0d20dbf9e9904fc874707f81
formal serial API code baseline: local develop @ 0e8ea7fc70d523de2cfa81173f1a421cad16ade7
round2 contract code tree anchor: f591aca69e9f6e4a20061c94ea564b053abe7be0
round2 initial unified local develop baseline: f44afac43282463cd9d7cce9e13668feedf8a133
round2 2C post-merge code anchor: 04aba1798b9ea1d834da56f5e072f936543bafc1
round2 pre-2B formal code baseline: local develop @ 2adae769caae1dce7f994de1d1ce63ab75b0fc36
round2 current code tree anchor: local develop @ 46813c3ecf4a0df1eaf99bfb3d8d72f7d450193b
round2 2B merge parents: ef07d09b9f16c2961659ee5afa0d917ef30bf4fd | 143a10a2aeff5ebacd1397a73a82d0ae3484a8da
round2 2A rebase and document baseline: local develop @ f3d68171826c20a849b9a8ca3d6bb5970e9ba49a
round2 2A merge parents: 5218f355128d20c8a7e37615d43259683bbc6980 | 1c4f9f29e890360e1439bf0d0962d3ccb5f73b56
round2 P2 remediation branch: feature/v2-round2-p2-remediation
round2 P2 remediation worktree: .worktrees/round2-p2-remediation
round2 P2 formal code baseline: local develop @ 446a36f16a5fcbc0e55b13be164c9108cac0403f
round2 P2 superseded contrast candidate: d05a78aba30bdca5d801189f2d05006a8f3da880
round2 P2 unique candidate: 0e354696ebe306c29b2be6ab265d4c93ff354dcc
round2 P2 browser acceptance: Chrome 151 + Edge 151 x 360x800 + 390x844 PASS
round2 P2 merge commit: local develop @ 5c2760cea40b975b24d5d2201333ab5048ce1cf0
round2 P2 merge parents: 78a708f889fb9b2539c34f027921ff9cfa7d9a67 | 0e354696ebe306c29b2be6ab265d4c93ff354dcc
round2 P2 status: MERGED_LOCAL / POST_MERGE_PASS
round2 P2 remediation whitelist: driver-gps-tracker.tsx | driver-gps-tracker.test.tsx | driver-workspace.tsx | driver-workspace.test.tsx
round2 P2 browser test modification whitelist: EMPTY
round2 P2 external system authorization: NONE
Gate 2 compatibility remediation candidate: 8fdfad7a35a287476572ef848630c23b4fd4da83
Gate 2 compatibility remediation merge: local develop @ a852c4fc52005748c2f3f4f9619d44f8f7513ff8
Gate 2 post-merge verification: 808 passed / 7 expected skipped | lint PASS | build 31/31 PASS | diff check PASS
3A/3B superseded baseline: 50525878ebe2b0b01ebc63dee782371a532f7cf5
3A/3B validated code baseline: local develop @ 8ff70cccf29371229818058055d45de376eebdf7
Gate 4 preparation source: local develop @ f835302d555fc0481a37dfc388bf8e4e382a6230
Gate 4 application tree anchor: 8ff70cccf29371229818058055d45de376eebdf7
3A branch/worktree: feature/v2-migration-validation | .worktrees/v2-migration-validation
3B branch/worktree: feature/v2-e2e-validation | .worktrees/v2-e2e-validation
T0 candidate/merge: 72cb11baad851f3a2fc2bf1ea6367affac679c96 | local develop @ 8ff70cccf29371229818058055d45de376eebdf7
3A/3B historical exit status: PASS_WARN / GATE4_ENTRY_COMPLETE
Gate 4 branch/worktree: feature/v2-stabilization | .worktrees/v2-stabilization
Gate 4 initial baseline: 4102ee1f85f89f363aeaa42f829a9c6d535f6d31
Gate 4 local code anchor: feature/v2-stabilization @ 4d370d664c3710a4a03cb1b665cfdeddc7d32778
Gate 4 remote tracking ref (not fetched this governance round): origin/feature/v2-stabilization @ 7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6
Gate 4 R55 parent/document baseline: c5e38e42af82a4fb144e93170cc5d4c9001f5a74
Gate 4 R56 remote acceptance document baseline: 7b6a2f472fe089b0a3dddf136b6f71f3b4a7e4f6
Gate 4 R57 document baseline: 355c7e4fef64533fcc15a75b70a472dfbd7f881e
Gate 4 local develop (not merged): 4102ee1f85f89f363aeaa42f829a9c6d535f6d31
Gate 4 CRLF remediation code anchor: 0c854224c703b3afaa18db2351d8bba3b263ad86
Gate 4 application directory tree: 5188c0efcb96d646a9609b7c47dd624d578841ee
Gate 4 local remediation status: LOCAL_SECURITY_REMEDIATION_PASS / INDEPENDENT_AUDIT_PASS / FIXED_R55_CRITICAL_HIGH_0 / SQL_RAW_19_OF_19_PASS
Gate 4 rejected RCs: 4102ee1f85f89f363aeaa42f829a9c6d535f6d31@sha256:5d9685bd49b4404dea4e04be0c4b009d3746e9fdb0325665a87e8b66e4024d30 | a0c8bbdcfd967dd45aa0f0c6f8f0c5d6aa736eac@sha256:8e671d612a2633e6fe52e7d10b79a6181dd1a51595ba8f846df0a4997743c541 | 857705e810172a1e53eb1355089d51a3ad8c7632@sha256:79c72cc67ecf718d8ddb54e562c52c325424ce55868a3d1d79a67b0de81b9823
Gate 4 remote RC status: REMOTE_RC_ACCEPTANCE_COMPLETE / G4_4_PASS
Gate 4 accepted RC index: sha256:508dea2dfa25da76581adc89b33d2ccf73eb91a21af26fa8f54e08fd94fe453d
Gate 4 accepted RC amd64: sha256:577dc21e8375d1ff07af4e49100799ac6ba1b1b225968e91f3559091bc04f414
Gate 4 accepted RC config: sha256:2930e8be2941a59fada8f8bef9614e95b83445c58e70a2f7b1337741baed8649
Gate 4 deployment status: G4_5_T0_PASS / T1_A_TO_T6_NOT_AUTHORIZED / NEW_RC_NOT_DEPLOYED
rejected dispatcher API candidate: feature/v2-dispatcher-api-wiring @ 319f73401359ef4a232a2217afaaef2ef4212af2
superseded unaligned API remediation candidate: feature/v2-dispatcher-api-wiring @ 5b84ab4881e1a8da12672c19d87098674798e60c
superseded API remediation candidate: feature/v2-dispatcher-api-wiring @ 60f03af3c73bb867a7139b705741135d276b50ab
merged audited T1 candidate: feature/v2-dispatcher-api-wiring @ 152f7c5142131a030be560a863285eb6d32d0a2f
data-model remediation develop commit: c6850df0a85aab601c3034e542a0f0b575c9053e
data-model remediation branch: feature/v2-dispatch-event-constraint
data-model remediation worktree: .worktrees/dispatch-event-constraint
data-model remediation whitelist: prisma/migrations/20260816120000_extend_dispatch_event_outbox_types/{migration.sql,rollback.sql}
remote tracking reference: origin/develop @ ae4714849fa965940b0df1c6766638cf398ac0ce (稍后处理)
parallel branch code tree anchor: f591aca69e9f6e4a20061c94ea564b053abe7be0
parallel branch start and document baseline: 主控下发的当前本地 develop HEAD（同时包含上述代码树与本次治理文档）
parallel worktrees: .worktrees/round2-admin-console | .worktrees/round2-driver-workflow | .worktrees/round2-observability
2A superseded candidate: feature/v2-admin-console @ 6562544361b29579b4e52c059ce8f85db7b72722 (code audit and browser test PASS on old base; patch replayed)
2A merged: feature/v2-admin-console @ 1c4f9f29e890360e1439bf0d0962d3ccb5f73b56 (merged by develop @ 46813c3; browser retest and post-merge 715/7, lint, 31/31 build and diff check PASS)
2B merged: feature/v2-driver-workflow @ 143a10a2aeff5ebacd1397a73a82d0ae3484a8da (merged by develop @ 2a621620; post-merge 674/7, lint, 29/29 build and diff check PASS)
2C merged: feature/v2-observability @ 04aba1798b9ea1d834da56f5e072f936543bafc1 (rebased from 99d6909 with identical patch; ff-only merged; post-merge PASS)
```

Gate 3 历史运行证据与 Gate 4 新候选须分开：最近已核验的预生产 app/worker 为 `958afca…@sha256:13e0…5bff`，Nginx release revision 对齐；本轮未重新连接云端。主工作区存量未提交代码不属于本次 Gate 4 验收对象。所有旧运行/回退镜像、G3E2E 和失败样本保留；不重复 bootstrap，不以治理同步推定新的运行健康结论。

## 真实 E2E 与 H5 新登记

- 首轮正式三单 ingest `3/3` 成功但未形成 A/B/C 的失败事实继续保留，详见
  [真实 E2E 首轮失败记录](2026-08-09-gate3r-real-e2e-first-round-failure.md)。
- Gate 3 最小返修、全实例高德 `3 QPS` 限流及其回归最终形成 `958afca…` 运行候选；服务端
  发布身份已对齐，外部 HTTP 契约、Schema、migration 和基础资料不变。
- 冻结真实 10 单已通过：订单 1～6、8～10 共 9 单完成；订单 7 按预期不可行且生成 1 条开放
  预警。订单 4～6 的第 6 单只在独立运行证据中使用 `-25` 目标，产品 `-30` 阈值和原始
  ZIP/manifest 均未改变。旧映射、边界抖动和预检失败现场继续保留。
- 到达前手动改排只有一次成功；旧版本、并发败方和到达后改排分别按冻结错误码拒绝。订单 10
  重放没有重复来源事件、订单、Assignment 或 outbox。详见[真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md)。
- 司机 H5 已按 PRD §9.2.2 与 API §2.2/§3.7 再冻结：复用三个 V2 读取接口、15 秒读取、
  30 秒位置上报、120 秒过期；Gate 3 的单一导航、测试标记过滤和位置同源读取不得回退。
- 调度员 13 个唯一 V2 URL 中，串行接线负责除 `/alerts`、`/logs` 外的 11 个；这两个路径
  继续由 2C 独占。V1 暂不删除，按兼容矩阵的切换与窗口关闭两个时点退出。
- API r17 已把 `/logs` 冻结为 `PageResultV2<OperationLogV2>`；前后值只允许共享 DTO
  白名单，原始 `metadataJson` 不得暴露。该契约提交为 `f591aca…`。
- 2A 旧候选 `6562544…` 相对 `f44afac…` 精确 14 个文件，代码审计与 Chrome/Edge ×
  100%/125% 浏览器矩阵均 `PASS`。两个提交随后无冲突线性重放到 `develop @ f3d6817…`，
  形成唯一新候选 `1c4f9f29…`；稳定 patch-id `7c758ab…` 和 14 文件边界与旧候选一致。
  新候选全量 `715 passed / 7 expected skipped`、lint、31/31 build、diff check、干净工作区
  和独立代码审计通过；Chrome 151、Edge 151 × 100%/125% 四组重点复验及 28 组关键场景
  随后全部 `PASS`。主控以 `--no-ff` 合入 `develop @ 46813c3…`，合入后再次通过同一全量、
  lint、31/31 build、diff check 和干净工作区。
- 2B 候选 `143a10a…` 在自身提交内形成 API r18：`GET /api/v2/driver/tasks` 的
  `DriverTaskV2.servicePlan` 必返并复用 `ServicePlanV2`。该候选已进入本地 develop，API r18
  因此成为当前 develop 现行契约。
- 2B 已直接重放到 `develop @ 2adae769…`，形成唯一候选 `143a10a…`；专项 `80/80`、
  2B/2C 联测 `29/29`、全量 `674 passed / 7 expected skipped`、lint、29/29 build、
  29 文件白名单与 diff check 通过。真实定位重采样、下班停报、四态文案、移动端滚动、
  轮询竞态、地图实例复用和共享任务 DTO 已返修；同一候选的独立代码审计已 `PASS`，未产生
  新代码 SHA。Chrome 151、Edge 151 × `360×800`、`390×844` 浏览器矩阵全部 `PASS`：实际
  视口准确、无横向滚动、点击目标不小于 44px，轮询不重置地图，Marker 与订单双向联动，
  A/B/C 动作、五种位置拒收和地图失败降级均符合冻结要求。主控随后以 `--no-ff` 合入，形成
  `develop @ 2a621620…`；合并提交的两个父节点为 `ef07d09…` 与 `143a10a…`，精确 29 个文件。
  合入后全量仍为 `674 passed / 7 expected skipped`，lint、29/29 build、diff check 和干净
  工作区通过，当前为 `MERGED_LOCAL / POST_MERGE_PASS`。
- 2B 浏览器验收遗留的 GPS live region 与司机端设计 token 两项 P2 已由唯一候选
  `0e354696…` 闭合。Chrome 151、Edge 151 × `360×800`、`390×844` 四组全部 `PASS`：无横向
  滚动，36 个可见点击目标均不小于 44px，live region/时间戳隔离、五种拒收文案、九组 WCAG AA
  对比度、Marker 联动、轮询不重置视野、地图失败降级和干净控制台均通过。候选随后以 `--no-ff`
  合入 `develop @ 5c2760c…`；合入后全量 `717 passed / 7 expected skipped`、lint、31/31 build、
  diff check 和干净工作区再次通过。随后 3A/3B 已从统一治理基线创建，但旧 `50525878…`
  首轮验收被 Gate 2 返修取代；两线必须从本轮新统一基线重新验收。
- 3A 在 Gate 2 返修后的统一基线上完成迁移与兼容重验，10 个 migration、映射、数据核对、
  rollback 保护/安全回退、再次 Forward 和 Schema 零漂移均通过，结论为 `PASS / WARN`。
- 3B 首轮发现的服务模块保留、改派错误优先级、下班状态回报和 4 处测试类型问题，已由候选
  `72cb11b…` 闭合并经代码审计、独立测试后合入 `develop @ 8ff70ccc…`。3B 随后完成 PRD §13
  14 项、真实隔离 PostgreSQL/API、故障与浏览器验收，结论为 `PASS / WARN`；Edge 调度台
  125% 是 `952×800` 等效布局证据，不是原生浏览器缩放证据。Chrome/Edge 控制台无错误，
  H5 `360×800`、`390×844` 为精确视口，全部临时资源已清理。
- 2C 原候选 `99d6909…` 在不改变 patch 的前提下线性重放到文档基线 `1e83782…`，修正提交
  说明后形成 `04aba179…`；稳定 patch-id 一致，精确 9 个白名单文件。专项及共享契约 `35/35`，
  合入前后全量均为 `648 passed / 7 expected skipped`，lint、29/29 build 和 diff check 通过；
  已 `--ff-only` 合入本地 develop，两个工作区干净，未推送或连接任何外部系统。
- 串行 API 审计缺口已分层闭合：数据模型提交 `c6850df…` 位于祖先链；候选 `152f7c5…`
  已补齐人工计划、地址重编码、严格版本冲突、跨门店释放、完整 `modificationHistory`、
  12 操作鉴权/traceId、分页及事务测试。T1-A、T1-B 和合并后回归全部通过，并已
  `--no-ff` 合入本地 `develop @ 8cfed6ad…`；远程尚未同步。
- 主工作区复审分支仍是历史脏现场；与本地 `develop` 比对后，司机鉴权主体已进入 `develop`，
  残余差异包含旧动态路由写法和测试缺失，不代表更新实现。本轮未覆盖该现场，2B 不得从其建分支。
- 现有司机页面仍保留 V1“接单”入口；这是待 2B 移除的兼容遗留，不改变 V2“司机无接单/
  拒单权，只能出发/到达/完成”的冻结产品规则。

## 故障注入与应用回退

- worker 停止期间 app HTTPS 保持 `200`；10 分钟基线 outbox 形成
  `DISPATCH_RESOURCE_BUSY` 积压，恢复单副本 worker 后 14 秒排空且错误清零。
- 应用按 app → worker → Nginx 回退到 `084649f4…@sha256:4664…5947` 用时 30 秒，按同序恢复
  `958afca…@sha256:13e0…5bff` 用时 31 秒；两阶段真实依赖 readiness、HTTPS、运行身份、
  outbox 和冻结 10 单执行状态通过。
- 早期错误脚本生成的 1 个独立 `G3FAULT` 订单保持 `UNASSIGNED / UNKNOWN`，outbox 已处理；
  它不属于冻结 10 单且未清理。完整失败现场与通过证据见[故障与回退验收](2026-08-10-gate3r-fault-rollback-acceptance.md)。

## Agent 上下文治理增量

本轮已建立并完成统一审查的项目级上下文分发能力，已随文档基线 `57ef86c…` 提交并推送：

- `docs/context/agent-common-context.md`：所有 Agent 必读的 Layer 0，当前不超过 150 行；
- `docs/versions/README.md`：为主控、前端、后端、数据库、地图调度、代码审计和测试提供可直接定位的角色入口；
- `docs/rcd-v2-project-map.canvas`：提供公共层、角色入口、同步闸门和当前放行边界的可视化导航；
- `.codex/hooks.json`：在主对话回合结束时提示用户是否以“提交并更新文档”授权本轮文档同步。

该机制不改变 Gate 3、产品、API、Schema、调度或基础设施裁决，也不自动执行 Git、数据库、部署或云资源操作。

## 状态文档维护规则

- 状态文档可以登记完成度、证据、阻断项和下一步，不能修改任何领域规则。
- 状态变化必须给出日期、证据和对应权威入口。
- “架构已冻结”不等于“资源已创建”，“Demo 运行过”不等于“生产已验收”。
- 结论冲突时回到[文档版本总入口](../versions/README.md)按领域裁决。

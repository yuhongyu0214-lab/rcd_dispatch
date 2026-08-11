# 人车单项目状态总览

> 状态快照：2026-08-11
> 用途：说明项目做到哪一步、还差什么
> 非权威范围：产品行为、状态机、Schema、枚举、HTTP 契约、技术栈和生产架构

## 一句话结论

Gate 3 当前唯一代码/镜像/预生产运行候选为 `958afca537b412fb972b6e180561a9b37022834d@sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`。2026-08-11 最终裁决确认无未解决 P0/P1，代码、镜像、运行资源、真实 10 单、并发与改排、预警、幂等、故障恢复、应用回退、migration 指纹和文档追溯全部满足退出条件，Gate 3 为 `PASS`。PASS 文档内容基线 `464ee5d6ffdb435d76b65f9814d82e4666fd84a9` 已远程核验；交接分支 `b853a7af245942758de1cd46c9a25c384c08ec62` 已合入并推送，Gate 3 代码交接点为 `develop @ 51ddb5ff7e7972032fd7ae9c0221b1937fb38a4e`。第二轮仍为 `AUTHORIZED / NOT_STARTED`，尚未创建分支；后续统一从状态激活后的同一 `origin/develop` HEAD 启动。

## 当前工作流状态

| 工作流 | 状态 | 证据/入口 | 下一闸门 |
|---|---|---|---|
| 文档治理 | `GATE3_PASS_BASELINE_COMMITTED_REMOTE_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | PASS 内容基线 `464ee5d…` 已提交、推送并完成三方核验 |
| 应用候选 | `958AFCA_GATE3_ACCEPTED_DEVELOP_HANDOFF_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变运行身份；代码已按分支流交接到 `develop @ 51ddb5f…` |
| 依赖安全 | `COMPLETED` | [依赖安全返修](2026-08-01-gate3-dependency-security-remediation.md) | 依赖变化时重跑全套审计 |
| migration 指纹 | `PREPROD_APPLIED_PASS` | [migration 清单](2026-08-01-gate3-migration-manifest.md) | 保持冻结，后续候选变化必须重新生成与迁移 |
| 数据库迁移 | `PREPROD_9_MIGRATIONS_OWNER_RETIRED_PASS` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 保持冻结，不得重复 migration |
| 隔离业务基础资料 | `BASE_DATA_PASS_TEST_FACTS_RETAINED` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 不重复基础资料写入；所有通过与失败样本均保留 |
| 基础设施文档 | `GATE3_FINAL_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | Gate 3-R 退出；正式可信 HTTPS 与整机/RDS 灾备仍为独立后续验收 |
| ACR 镜像发布 | `958AFCA_DIGEST_RUNTIME_PASS` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 保持 `958afca…@sha256:13e0…5bff`，不得混用或再次重建 |
| 阿里云预生产准备 | `FINAL_CONSISTENCY_RUNTIME_PASS` | [故障与回退验收](2026-08-10-gate3r-fault-rollback-acceptance.md) | 不再变更服务；正式可信 HTTPS 与整机/RDS 灾备另行验收 |
| 本地 Docker Desktop | `DATA_MOVED_TO_D_NTFS_BACKUP_RETAINED` | `D:\DockerDesktop\data\DockerDesktopWSL` | 镜像、版本、容器与卷核验通过；完整 VHDX 备份保留，不影响生产架构 |
| 既有预生产成果审查 | `RUNTIME_FINAL_CONSISTENCY_PASS` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 保持备份、9 个 migration、最小权限、单 worker 和运行身份不变 |
| 真实 10 单 | `REAL10_PASS_9_COMPLETED_1_INFEASIBLE_ALERT` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 保留全部成功与失败现场，不清理 |
| Gate 3 总闸门 | `PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变候选与证据，进入受控阶段交接 |
| 第二轮并行 | `AUTHORIZED_NOT_STARTED` | 同上 | 前置交接已满足；尚未创建分支，等待下一份明确任务单并使用最终 `origin/develop` HEAD |

## 唯一代码、文档与迁移基线

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
```

中间提交、来源分支和主工作区未提交代码不属于 Gate 3 当前验收对象。当前 HEAD、Git 远程、ACR 与预生产 app/worker 均为 `958afca…@sha256:13e0…5bff`；Nginx 沿用原镜像、配置、证书和端口，只把运行 revision 刷新为 `958afca…`。`7595a649…`、`4eb3b485…`、`084649f4…` 与迁移期候选继续保留，运行不得混用；`08d84cfc…` 是被后续限流返修取代、未进入预生产运行的候选。app、worker、Nginx、本机结构化日志、轮转和 SLS 集中观测仍健康；G3E2E R2.2 基础资料禁止重复整批写入，所有失败证据继续保留。

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
- 实时高德地图、获准的司机/订单标记和整体排版重做进入第二轮产品/API 再冻结；当前只获准
  准备，不在本轮文档同步中创建分支或实施代码。

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

- `docs/context/agent-common-context.md`：所有 Agent 必读的 Layer 0，当前 127 行；
- `docs/versions/README.md`：为主控、前端、后端、数据库、地图调度、代码审计和测试提供可直接定位的角色入口；
- `docs/rcd-v2-project-map.canvas`：提供公共层、角色入口、同步闸门和当前放行边界的可视化导航；
- `.codex/hooks.json`：在主对话回合结束时提示用户是否以“提交并更新文档”授权本轮文档同步。

该机制不改变 Gate 3、产品、API、Schema、调度或基础设施裁决，也不自动执行 Git、数据库、部署或云资源操作。

## 状态文档维护规则

- 状态文档可以登记完成度、证据、阻断项和下一步，不能修改任何领域规则。
- 状态变化必须给出日期、证据和对应权威入口。
- “架构已冻结”不等于“资源已创建”，“Demo 运行过”不等于“生产已验收”。
- 结论冲突时回到[文档版本总入口](../versions/README.md)按领域裁决。

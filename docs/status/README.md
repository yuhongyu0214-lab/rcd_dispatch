# 人车单项目状态总览

> 状态快照：2026-08-27
> 用途：说明项目做到哪一步、还差什么
> 非权威范围：产品行为、状态机、Schema、枚举、HTTP 契约、技术栈和生产架构

## 一句话结论

Gate 3、第二轮和 P2 保持 `PASS`。3A 首轮发现的 Gate 2 兼容窗口缺口已由 `8fdfad7…` 修复并合入本地 `develop @ a852c4f…`；合入后 `808 passed / 7 expected skipped`、lint、31/31 build 和 diff check 通过。3A/3B 旧 `50525878…` 验收起点失效，当前为 `GATE2_REMEDIATION_MERGED_LOCAL / NEW_BASELINE_FROZEN / 3A_3B_REVALIDATION_PENDING`；新统一基线是本治理文档所在提交，未推送。

## 当前工作流状态

| 工作流 | 状态 | 证据/入口 | 下一闸门 |
|---|---|---|---|
| 文档治理 | `GATE2_REMEDIATION_MERGED_LOCAL / NEW_BASELINE_FROZEN` | Gate 2 合并点 `a852c4f…`；本轮仅同步 5 份治理文件 | 由主控公布本治理提交的完整 `BASELINE_SHA` |
| 应用候选 | `958AFCA_GATE3_ACCEPTED_DEVELOP_HANDOFF_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变运行身份；代码历史交接点为 `develop @ 51ddb5f…`，最终状态激活 HEAD 为 `ae471484…` |
| 依赖安全 | `COMPLETED` | [依赖安全返修](2026-08-01-gate3-dependency-security-remediation.md) | 依赖变化时重跑全套审计 |
| migration 指纹 | `PREPROD_9_APPLIED_LOCAL_10_PASS` | 第 10 个 migration 提交 `c6850df0a85aab601c3034e542a0f0b575c9053e` | 隔离 PostgreSQL 已通过；预生产 9 个保持不变，未经授权不实施第 10 个 |
| 数据库迁移 | `OUTBOX_CHECK_REMEDIATION_PASS_LOCAL_DEVELOP` | 两个新事件 CHECK、受保护 rollback、零漂移和全量回归通过 | 数据分支退出；API 分支重放新基线后使用该约束，禁止重复迁移 |
| 隔离业务基础资料 | `BASE_DATA_PASS_TEST_FACTS_RETAINED` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 不重复基础资料写入；所有通过与失败样本均保留 |
| 基础设施文档 | `GATE3_FINAL_PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | Gate 3-R 退出；正式可信 HTTPS 与整机/RDS 灾备仍为独立后续验收 |
| ACR 镜像发布 | `958AFCA_DIGEST_RUNTIME_PASS` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 保持 `958afca…@sha256:13e0…5bff`，不得混用或再次重建 |
| 阿里云预生产准备 | `FINAL_CONSISTENCY_RUNTIME_PASS` | [故障与回退验收](2026-08-10-gate3r-fault-rollback-acceptance.md) | 不再变更服务；正式可信 HTTPS 与整机/RDS 灾备另行验收 |
| 本地 Docker Desktop | `DATA_MOVED_TO_D_NTFS_BACKUP_RETAINED` | `D:\DockerDesktop\data\DockerDesktopWSL` | 镜像、版本、容器与卷核验通过；完整 VHDX 备份保留，不影响生产架构 |
| 既有预生产成果审查 | `RUNTIME_FINAL_CONSISTENCY_PASS` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 保持备份、9 个 migration、最小权限、单 worker 和运行身份不变 |
| 真实 10 单 | `REAL10_PASS_9_COMPLETED_1_INFEASIBLE_ALERT` | [真实 E2E 重验进度](2026-08-10-gate3r-real-e2e-retest-progress.md) | 保留全部成功与失败现场，不清理 |
| Gate 3 总闸门 | `PASS` | [最终闸门裁决](2026-08-11-gate3-final-gate-decision.md) | 保持不可变候选与证据，进入受控阶段交接 |
| 串行调度员 V2 API 接线 | `T1_PASS / MERGED_LOCAL / POST_MERGE_PASS` | 候选 `152f7c5…` 已合入 `develop @ 8cfed6ad…`；T1 与合并后全量回归通过 | 串行前置退出；保持本地合并且暂不推送 |
| 第二轮并行 | `MERGED_LOCAL / POST_MERGE_PASS / P2_EXIT_PASS` | P2 候选 `0e354696…` 已合入 `develop @ 5c2760c…` | 第二轮退出；进入 3A/3B 并行验证前置 |
| 并行验证 3A/3B | `NEW_BASELINE_FROZEN / REVALIDATION_PENDING` | 旧基线首轮：3A 触发 Gate 2 返修；3B FAIL 证据保留 | 两 worktree 对齐新基线；3A 重验，3B 先闭合 T0 返修再重验 |

## 3A/3B 冻结任务卡

新统一基线定义为本治理文档所在提交，其完整 SHA 由主控提交后下发（同一提交内不自引用），不得猜测。两条现有干净 worktree 必须快进到该同一 SHA，旧 `50525878…` 结果只能作为问题证据，不能作为 Gate 4 入口证据。

| 验证线 | 角色、分支与 worktree | 初始修改边界 | 隔离候选与外部边界 | 必须达成 |
|---|---|---|---|---|
| 3A | 数据库验证 Agent；`feature/v2-migration-validation`；`.worktrees/v2-migration-validation` | 新基线白名单重新归零 | PostgreSQL 18.3 `127.0.0.1:55437`；禁止外部系统、预生产和真实 RDS/Tair/高德 | 重新验证 V1/V2 映射、兼容窗口、10 个 migration、数据、rollback 与零漂移 |
| 3B | 测试 Agent；`feature/v2-e2e-validation`；`.worktrees/v2-e2e-validation` | 首轮 FAIL；T0 稳定化返修独立执行，未获新授权前不得改业务文件 | PostgreSQL 18.3 `127.0.0.1:55438`、app `3048`、Mock `3049`；仅本地 Mock，无外部授权 | T0 返修进入统一基线后，重验 PRD §13 14 项、故障、浏览器与全部工程命令 |

分支创建后仍为 `NOT_STARTED`。任一出现 HEAD/基线不一致、工作区不干净、端口/数据库身份/空库状态不明、需要修改 Schema/migration/API 契约/业务代码、需要外部连接/新依赖/跨域文件、权威文档冲突，或 rollback 需要删除事实绕过保护，必须停止并回报主控。

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
3A/3B new unified baseline: 本治理文档所在提交（完整 SHA 由主控提交后下发，同一提交内不自引用）
3A branch/worktree: feature/v2-migration-validation | .worktrees/v2-migration-validation
3B branch/worktree: feature/v2-e2e-validation | .worktrees/v2-e2e-validation
3A/3B status: NEW_BASELINE_FROZEN / REVALIDATION_PENDING
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
- 3A 首轮复验发现 V1 写接口切换缺口；返修候选 `8fdfad7…` 仅改 5 个批准文件，专项、全量、
  lint、build 与运行态路由验证通过，并以 `--no-ff` 合入本地 `develop @ a852c4f…`。
- 3B 首轮 `FAIL` 证据保留：重排后服务模块丢失、改派错误优先级、下班状态回报及 4 处测试类型
  债务。T0 单一稳定化 worktree 已建立但尚无代码改动；必须对齐新基线、完成返修和审计后再重验。
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

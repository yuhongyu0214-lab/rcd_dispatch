# Gate 3 最终闸门裁决

> 文档类型：`STATUS / FINAL_GATE_DECISION / EVIDENCE`
>
> 裁决日期：2026-08-11（Asia/Shanghai）
>
> 代码候选：`codex/v2-gate3-app-candidate @ 958afca537b412fb972b6e180561a9b37022834d`
>
> ACR index digest：`sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`
>
> 文档内容基线：`feature/v2-gate3-review-remediation @ 57ef86c43bf220f48774e130575c40b8c94a83d5`
>
> 文档状态激活提交：`3ee8cfc6f5b7706a193172f67f27e98056d9e9fe`
>
> 最终结论：`GATE3_PASS`

## 1. 白话结论

Gate 3 最终验收通过。冻结的代码、镜像、预生产运行身份、真实 10 单、并发与改排、预警、
幂等、worker 故障恢复、应用回退、migration 指纹和文档基线均满足退出条件，没有未解决的
P0/P1。

第二轮 Web、司机接口与观测工作获得进入准备阶段的资格，但本裁决不自动创建分支、合并代码、
部署、执行 migration、重复写基础资料或清理失败证据。本轮状态同步形成新的可追溯文档提交，
且 Gate 3 候选按批准的 `feature/* → develop` 路径完成交接前，第二轮保持 `AUTHORIZED / NOT_STARTED`。

## 2. 最终裁决依据

| 核验域 | 结果 | 证据摘要 |
|---|---|---|
| P0/P1 | `PASS` | 无未解决 P0/P1；Gate 3 六项退出条件全部满足 |
| 代码与远程 | `PASS` | 候选 worktree 干净；本地、upstream、GitHub 均为 `958afca…` |
| 文档追溯 | `PASS` | 内容基线 `57ef86c…`、状态激活提交 `3ee8cfc…` 已完成本地/upstream/GitHub 核验 |
| 本地回归 | `PASS` | 53 个测试文件、517 个测试通过；7 个无本地真实依赖的集成测试按设计跳过，真实预生产证据覆盖 |
| 代码检查与构建 | `PASS` | `pnpm lint` 与 Next.js 生产构建通过；构建含类型检查和 29 个页面生成 |
| migration 指纹 | `PASS` | 17 个 SQL 逐项无不匹配；正向清单与全部 SQL 聚合 SHA-256 均与冻结值一致 |
| 预生产运行身份 | `PASS` | app/worker 精确运行冻结 digest；三容器 revision 为 `958afca…`；worker 单副本；Nginx 原镜像不变 |
| 公网健康 | `PASS` | 跨日复核 `/api/health` 仍返回 HTTP 200 与统一响应结构 |
| 真实业务 | `PASS` | 9 单完成；订单 7 按预期 `INFEASIBLE` 并保留 1 条 `OPEN` 预警 |
| 并发与改排 | `PASS` | 到达前只有一次改排成功；旧版本、并发败方和到达后改排按冻结错误码拒绝 |
| 接入幂等 | `PASS` | 订单 10 同版本重放未产生第二份订单、来源事件、Assignment 或 outbox |
| 故障与回退 | `PASS` | worker 积压 14 秒恢复；应用回退 30 秒、恢复当前候选 31 秒；业务事实未漂移 |

完整运行证据见[真实 10 单重验](2026-08-10-gate3r-real-e2e-retest-progress.md)、
[故障与回退验收](2026-08-10-gate3r-fault-rollback-acceptance.md)和
[最终一致性终审](2026-08-10-gate3-final-consistency-review.md)。

## 3. 退出条件逐项裁决

| Gate 3 退出条件 | 裁决 |
|---|---|
| 旧计算不能覆盖新计划 | `PASS`：`planVersion`、短锁、事务复核和旧版本 409 证据通过 |
| 重复事件不产生重复排程或派单 | `PASS`：订单 10 重放与 outbox 幂等证据通过 |
| 到达后服务端拒绝改派 | `PASS`：返回 `400 / ILLEGAL_TRANSITION` |
| 高德失败不使用假 ETA | `PASS`：自动化降级测试与预生产真实高德调用证据通过 |
| Assignment、预警、日志和版本在一致事务边界提交 | `PASS`：代码回归、真实 10 单和 outbox 证据通过 |
| 并发和状态流转测试通过 | `PASS`：并发败方 409、旧版本 409、司机执行链路和全量回归通过 |

## 4. 非阻断观察

最终裁决追加的远程证据校验和重算在跨日后遇到 ECS SSH 22 端口连接超时；连接没有建立，
因此既不是校验和失败，也没有修改服务器。此前正式七组证据的 checksum 已通过，跨日公网
HTTPS 健康仍为 200，GitHub SHA 未漂移。该项登记为 P2 运维观察；若后续管理连接持续超时，
由运维任务单独排查，不反向否定本次 Gate 3 业务与应用验收。

## 5. PASS 后的冻结边界

- 保持 `958afca…@sha256:13e0…5bff` 为 Gate 3 不可变验收候选，禁止使用 `latest` 或混用镜像。
- 保留首轮失败、门店映射失败、边界抖动、helper 偏差、`G3FAULT` 订单和历史 migration 容器。
- 不重复执行 9 个 migration，不重复写入 G3E2E 基础资料，不直接修改业务数据库。
- 本裁决不自动合并 `develop`，不自动创建第二轮分支，不授权部署或云资源变更。
- 第二轮启动前，先提交并推送本轮 Gate 3 `PASS` 文档同步，再由主控指定统一 `develop` 基线、
  分支、文件白名单和验收标准。
- Gate 3 后已登记的司机 H5 实时高德地图、获准点位和整体排版进入第二轮产品/API 再冻结，
  不反向扩大已通过的 Gate 3 范围。

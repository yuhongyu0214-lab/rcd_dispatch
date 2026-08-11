# Gate 3 文档、代码、镜像与运行资源一致性终审

> 文档类型：`STATUS / REVIEW / EVIDENCE`
>
> 日期：2026-08-10
>
> 环境：阿里云上海预生产 `rcd_v2_preprod`
>
> 代码候选：`codex/v2-gate3-app-candidate @ 958afca537b412fb972b6e180561a9b37022834d`
>
> 镜像：`sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`（ACR index digest）
>
> 结论：`DOCUMENT_BASELINE_PASS / GATE3_FINAL_PASS`（2026-08-11 主控裁决）

## 1. 白话结论

代码仓库、镜像仓库和预生产服务器使用的是同一版程序，系统健康、冻结 10 单、故障恢复和
应用回退结果也没有漂移。文档中的旧候选和旧进度已经返修，并已形成可追溯文档基线
`feature/v2-gate3-review-remediation @ 57ef86c43bf220f48774e130575c40b8c94a83d5`；本地、upstream
与 GitHub 远程 SHA 完全一致。主控已于 2026-08-11 完成最终裁决，Gate 3 为 `PASS`；
不需要重新构建或部署。

## 2. 代码与镜像一致性

| 核验项 | 结果 |
|---|---|
| 候选 worktree | 干净；分支 `codex/v2-gate3-app-candidate` |
| 本地 HEAD / upstream | `958afca537b412fb972b6e180561a9b37022834d` |
| GitHub 远程分支 | 只读 `ls-remote` 返回同一完整 SHA |
| ACR 标签 | `958afca…` 解析为 index digest `sha256:13e0…5bff` |
| amd64 manifest | `sha256:04798acbaa142e97b5bc2cdba85d3852e5c0261da9a3368c9c6ba73e24127f87` |
| app / worker | 均按上述 index digest 运行，OCI revision 均为 `958afca…` |
| Nginx | 沿用 `nginx:1.27-alpine`，镜像 ID `sha256:62223d…ac8`，运行 revision 为 `958afca…` |

## 3. 运行资源与业务事实

| 核验项 | 结果 |
|---|---|
| 服务副本 | app、worker、Nginx 各 1 个 |
| 公网入口 | Nginx 80/443；app/worker 未发布应用端口；ECS 管理 SSH 22 保留 |
| 本机日志护栏 | 三服务均为 Docker `json-file`，`20m × 5` |
| Nginx | 配置语法检查通过；原配置、证书挂载和端口边界保持不变 |
| 日志采集 | `loongcollectord.service` active；既有 `3.2.6` 与 SLS 验收结论继续有效 |
| HTTPS | `/api/health` 返回 200 |
| 应用 readiness | liveness/readiness 200；数据库、Redis/Tair、高德均 `ready` |
| 冻结 10 单 | `count=10`；`completed=9`；订单 7 为 `UNASSIGNED / INFEASIBLE` 且 `openAlerts=1` |
| outbox | `pending=0`，`failed=0` |
| worker 故障证据 | `/home/rcdops/evidence/gate3r-worker-fault-20260810T103706Z` checksum PASS |
| 应用回退证据 | `/home/rcdops/evidence/gate3r-application-rollback-20260810T104522Z` checksum PASS |

历史 migration 容器仍以 `Exited (0)` 保留，没有重跑或清理。终审没有修改 app、worker、
Nginx、RDS、Tair、业务数据、基础资料或证据现场。

## 4. 文档终审与返修

终审发现并在工作树中返修以下 P1 文档漂移：

- 数据架构、API 契约、领域词汇和应用决策页眉仍指向旧候选 `4eb3b485…`；
- 基础设施架构页眉仍写预生产“尚未实施”；
- Gate 3-R 计划仍写真实 E2E、故障和回退待验收；
- 状态总览仍写运行时验收待完成；
- 文档总入口仍写订单 7～10 尚待执行；
- Layer 0、主计划、AGENTS 和 Canvas 仍写等待最终一致性审查。

返修只校正候选 SHA、预生产实施事实、终审状态和下一步；产品行为、`-30` 阈值、API、
Schema、migration、枚举、依赖和设计变量没有变化。

返修后验证结果：

| 检查 | 结果 |
|---|---|
| 本轮 9 项版本标识（含总入口） | 全部匹配 |
| 本轮相关 Markdown 本地链接 | 0 个断链 |
| Layer 0 | 126 行，未超过 150 行上限 |
| Canvas | JSON 解析通过，69 个节点、80 条连线 |
| 文档差异格式 | `git diff --check` 通过 |

## 5. 失败判定与当前闸门

根据并行开发主计划：无 P0 但存在当前阶段必须关闭的 P1 时，结论为 `WARN`，不得放行下一阶段。
本轮运行侧和文档内容复核已通过；此前阻断 Gate 3 的文档基线 P1 已由提交
`57ef86c43bf220f48774e130575c40b8c94a83d5` 关闭，分支为
`feature/v2-gate3-review-remediation`，本地、upstream 和 GitHub 远程核验一致。

因此当前结论为：

```text
runtime consistency: PASS
document content after remediation: PASS
traceable document baseline SHA: PASS (57ef86c43bf220f48774e130575c40b8c94a83d5)
Gate 3: PASS
second round: AUTHORIZED / NOT_STARTED
```

最终裁决依据与 PASS 后冻结边界见
[2026-08-11 Gate 3 最终闸门裁决](2026-08-11-gate3-final-gate-decision.md)。本轮 PASS 文档形成
新的可追溯提交、且 Gate 3 候选按批准路径完成 `develop` 交接前，不创建第二轮分支；不得因此
重新构建镜像、部署、执行 migration、写入基础资料或清理业务证据。

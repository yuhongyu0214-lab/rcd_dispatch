# 人车单项目状态总览

> 状态快照：2026-08-03
> 用途：说明项目做到哪一步、还差什么
> 非权威范围：产品行为、状态机、Schema、枚举、HTTP 契约、技术栈和生产架构

## 一句话结论

Gate 3 当前可追溯应用候选为 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`。Git 远程与 ACR 镜像已对齐该 SHA，digest 为 `sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d`；Compose 完整命令前缀修正已经完成回归、提交、普通推送与镜像追溯。ECS 仍保留上一候选 `7378303…` 与回退候选 `169f2ad…`，当前镜像尚未拉取；亦未注入应用秘密、连接 RDS/Tair、执行 migration 或启动容器。Gate 3 未 `PASS`，第二轮并行继续冻结。

## 当前工作流状态

| 工作流 | 状态 | 证据/入口 | 下一闸门 |
|---|---|---|---|
| 文档治理 | `UPDATED_AWAITING_BASELINE_COMMIT` | [文档版本总入口](../versions/README.md) | 审查 Layer 0、角色入口、Canvas 与 Stop Hook 后形成文档基线 SHA |
| 应用候选 | `GIT_ACR_TRACE_PASS_AWAITING_ECS_PULL` | [部署入口加固证据](2026-08-02-gate3-deployment-entry-hardening.md) | `492c86e…` 完整回归、提交、远程与 ACR 追溯通过；待 ECS 按 digest 拉取 |
| 依赖安全 | `COMPLETED` | [依赖安全返修](2026-08-01-gate3-dependency-security-remediation.md) | 依赖变化时重跑全套审计 |
| migration 指纹 | `REHEARSED` | [migration 清单](2026-08-01-gate3-migration-manifest.md) | 阿里云预生产变更闸门 |
| 数据库迁移 | `EMPTY_DB_REHEARSAL_PASS` | [空库演练报告](../superpowers/reports/2026-08-01-gate3r-empty-postgresql-rehearsal.md) | 进入阿里云预生产 migration 变更闸门 |
| 基础设施文档 | `FROZEN_AWAITING_IMPLEMENTATION` | [基础设施状态](2026-08-01-infrastructure-baseline-status.md) | 完成阿里云预生产实施与证据 |
| ACR 镜像发布 | `CURRENT_PREVIOUS_ROLLBACK_DIGESTS_PASS` | [ACR/ECS 镜像追溯证据](2026-08-02-gate3r-acr-image-publication.md) | 当前镜像已在 ACR；上一与回退镜像已在 ECS；待拉取当前 digest |
| 阿里云预生产准备 | `BLOCKED_BEFORE_MIGRATION_AND_START` | [预生产准备包](2026-08-01-gate3r-aliyun-preproduction-preparation.md) | 恢复 `rcdops` 登录后只准备目录、权限、变量模板和拉取镜像；禁止 migration 与容器启动 |
| 本地 Docker Desktop | `DATA_MOVED_TO_D_NTFS_BACKUP_RETAINED` | `D:\DockerDesktop\data\DockerDesktopWSL` | 镜像、版本、容器与卷核验通过；完整 VHDX 备份保留，不影响生产架构 |
| 既有预生产成果审查 | `REQUEST_CHANGES` | [去重审查报告](../superpowers/reports/2026-08-01-preprod-existing-work-audit.md) | 先返修既有权限方案，再补应用部署包 |
| Gate 3 总闸门 | `NOT_PASS` | [V2 并行开发主计划](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md) | Gate 3-R 阿里云实施 + 终审 |
| 第二轮并行 | `FROZEN` | 同上 | 仅 Gate 3 `PASS` 后放行 |

## 唯一代码与迁移基线

```text
branch: codex/v2-gate3-app-candidate
local commit: 492c86ea51b40da9426b8ad5b6aef861aa429ab5
remote commit: 492c86ea51b40da9426b8ad5b6aef861aa429ab5
migration count: 9
forward-manifest sha256: a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d
all-sql aggregate sha256: b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f
rollback image tag: 169f2ad8b27f9f0be2d4630144315694656b6a67
rollback image digest: sha256:6e37995289a05a7462bd02b873498ae5cc87fda70ebe73e0d29b53d258cb2674
previous candidate image tag: 7378303f513d92e781a7930cfff7e14269ec3126
previous candidate image digest: sha256:1292f8f552c5528c20f48737fe6d2b47bd0aa14813e89eaf4a8f4381f77aaf57
current candidate image tag: 492c86ea51b40da9426b8ad5b6aef861aa429ab5
current candidate image digest: sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d
```

中间提交、来源分支和主工作区未提交代码不属于 Gate 3 当前验收对象。当前 HEAD、Git 远程和 ACR 镜像均为 `492c86e…`；Compose 命令修正已经形成可追溯发布基线。ECS 尚未拉取当前镜像，上一候选与回退候选继续保留。

## Agent 上下文治理增量

本轮已建立以下项目级上下文分发能力，但当前仍在工作区中等待统一审查和文档基线提交：

- `docs/context/agent-common-context.md`：所有 Agent 必读的 Layer 0，当前 126 行；
- `docs/versions/README.md`：为主控、前端、后端、数据库、地图调度、代码审计和测试提供可直接定位的角色入口；
- `docs/rcd-v2-project-map.canvas`：提供公共层、角色入口、同步闸门和当前放行边界的可视化导航；
- `.codex/hooks.json`：在主对话回合结束时提示用户是否以“提交并更新文档”授权本轮文档同步。

该机制不改变 Gate 3、产品、API、Schema、调度或基础设施裁决，也不自动执行 Git、数据库、部署或云资源操作。

## 状态文档维护规则

- 状态文档可以登记完成度、证据、阻断项和下一步，不能修改任何领域规则。
- 状态变化必须给出日期、证据和对应权威入口。
- “架构已冻结”不等于“资源已创建”，“Demo 运行过”不等于“生产已验收”。
- 结论冲突时回到[文档版本总入口](../versions/README.md)按领域裁决。

# 人车单项目状态总览

> 状态快照：2026-08-05
> 用途：说明项目做到哪一步、还差什么
> 非权威范围：产品行为、状态机、Schema、枚举、HTTP 契约、技术栈和生产架构

## 一句话结论

Gate 3 当前可追溯应用候选为 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`。Git 远程、ACR 与 ECS 当前镜像均已按 digest 对齐该 SHA；上一候选 `7378303…` 与回退候选 `169f2ad…` 继续保留。`rcd_v2_preprod` 已完成 0805 全量备份、冻结的 9 个 migration、迁移后逐表最小权限和失败关闭验收；app、worker、Nginx 尚未启动。Gate 3 未 `PASS`，第二轮并行继续冻结。

## 当前工作流状态

| 工作流 | 状态 | 证据/入口 | 下一闸门 |
|---|---|---|---|
| 文档治理 | `UPDATED_AWAITING_BASELINE_COMMIT` | [文档版本总入口](../versions/README.md) | 审查 Layer 0、角色入口、Canvas 与 Stop Hook 后形成文档基线 SHA |
| 应用候选 | `GIT_ACR_ECS_DIGEST_PASS_AWAITING_APP_START` | [部署入口加固证据](2026-08-02-gate3-deployment-entry-hardening.md) | 当前 digest、revision 与 `linux/amd64` 已在 ECS 核验；待 app-only 启动闸门 |
| 依赖安全 | `COMPLETED` | [依赖安全返修](2026-08-01-gate3-dependency-security-remediation.md) | 依赖变化时重跑全套审计 |
| migration 指纹 | `PREPROD_APPLIED_PASS` | [migration 清单](2026-08-01-gate3-migration-manifest.md) | 保持冻结，后续候选变化必须重新生成与迁移 |
| 数据库迁移 | `PREPROD_9_MIGRATIONS_POSTGRANT_PASS` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 关闭 owner 长期连接入口后进入 app-only 启动闸门 |
| 基础设施文档 | `RDS_SUBGATE_PASS_RUNTIME_PENDING` | [基础设施状态](2026-08-01-infrastructure-baseline-status.md) | 完成 app/worker/edge、SLS、健康与回退证据 |
| ACR 镜像发布 | `CURRENT_PREVIOUS_ROLLBACK_ECS_DIGESTS_PASS` | [ACR/ECS 镜像追溯证据](2026-08-02-gate3r-acr-image-publication.md) | 三份镜像继续保留；运行只认当前完整 digest |
| 阿里云预生产准备 | `RDS_SUBGATE_PASS_AWAITING_APP_START` | [预生产准备包](2026-08-01-gate3r-aliyun-preproduction-preparation.md) | 关闭 migration owner 长期入口，再单独批准 app-only 启动与 readiness |
| 本地 Docker Desktop | `DATA_MOVED_TO_D_NTFS_BACKUP_RETAINED` | `D:\DockerDesktop\data\DockerDesktopWSL` | 镜像、版本、容器与卷核验通过；完整 VHDX 备份保留，不影响生产架构 |
| 既有预生产成果审查 | `RDS_PERMISSION_REMEDIATED_RUNTIME_PENDING` | [RDS 迁移与权限证据](2026-08-05-gate3r-rds-preprod-migration-permissions.md) | 数据权限返修已实施；继续运行时验收 |
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

中间提交、来源分支和主工作区未提交代码不属于 Gate 3 当前验收对象。当前 HEAD、Git 远程、ACR 和 ECS 当前镜像均为 `492c86e…` 对应的完整 digest；Compose 命令修正已经形成可追溯发布基线。预生产 9 个 migration 与对象权限验收已通过，上一候选与回退候选继续保留，app/worker/Nginx 尚未启动。

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

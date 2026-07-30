# 人车单项目文档版本总入口

> 版本戳：`RCD-DOC-REGISTRY-20260730`
> 建立日期：2026-07-13
> 归档方式：默认逻辑归档；只有经引用检查确认会直接误导实施、且历史摘要已经保留的文件才允许删除

## 阅读规则

1. 新的产品、数据、调度和界面设计，以 `V2.0` 目录为当前依据。
2. 文档权威按领域拆分（见下），不做整份文档互相覆盖：工程纪律域以根目录 `AGENTS.md` 为准，各业务域以对应 V2 文档为准。
3. `V1` 目录是历史索引。被索引的原文件继续保留，只用于追溯已有代码。
4. 未标版本的旧文档默认按 V1 或过渡期材料处理，不自动升级为 V2 规则。

## 当前有效版本

| 范围 | 当前版本 | 状态 | 入口 |
|---|---|---|---|
| 产品需求 | V2.0 | Gate 3-R R7 已冻结 | [PRD V2](v2.0/prd-v2.md) |
| 数据架构 | V2.0 | Gate 0 已冻结 | [数据架构 V2](v2.0/data-architecture-v2.md) |
| 代码与设计约束 | V2.0 | Gate 3-R R7 已冻结 | [项目规则 V2](v2.0/project-rules-v2.md) |
| API 契约 | V2.0 | Gate 3-R R7 已冻结 | [API 契约 V2](v2.0/api-contract-v2.md) |
| 领域词汇 | V2.0 | Gate 0 已冻结 | [领域词汇 V2](v2.0/domain-glossary-v2.md) |
| V1→V2 兼容映射 | V2.0 | Gate 0 已冻结 | [兼容矩阵](v2.0/v1-v2-compatibility-matrix.md) |
| 生产基础设施架构 | V2.0 | Gate 3-R R7 已冻结；尚未实施 | [基础设施架构 V2](v2.0/infrastructure-v2.md) |
| 构建、部署与回退 | V2.0 | Gate 3-R R7 已冻结；尚未实施 | [部署指南 V2](v2.0/deployment-guide-v2.md) |
| 生产运行与恢复 | V2.0 | Gate 3-R R7 已冻结；尚未实施 | [运维指南 V2](v2.0/operations-guide-v2.md) |
| 基础设施决策与替代历史 | V2.0 | Gate 3-R R7 已冻结 | [基础设施决策日志](v2.0/infrastructure-decision-log.md) |
| V1 产品与开发主线 | V1.x | 历史只读 | [V1 历史索引](v1/README.md) |

## 文档权威顺序（按领域拆分，唯一权威口径）

同一事项只认领域对应的权威文档，文档之间不做整份互相覆盖：

```text
工程纪律                → AGENTS.md（工程铁律部分）
产品行为                → v2.0/prd-v2.md
数据模型                → v2.0/data-architecture-v2.md
术语与枚举              → v2.0/domain-glossary-v2.md
HTTP 契约               → v2.0/api-contract-v2.md
迁移与兼容              → v2.0/v1-v2-compatibility-matrix.md
代码一致性与设计系统    → v2.0/project-rules-v2.md
生产基础设施架构        → v2.0/infrastructure-v2.md
构建、部署与回退        → v2.0/deployment-guide-v2.md
生产运行与恢复          → v2.0/operations-guide-v2.md
基础设施决策与替代历史  → v2.0/infrastructure-decision-log.md
```

- 数据安全与不可逆操作原则高于以上一切。
- V1 文档仅用于追溯；原型、演示数据和临时说明不得反向定义规则。
- 同一事项在两份文档中冲突、且无法按领域判断归属时：**暂停实现并升级裁决**，不得自行取舍。

若代码与 V2 文档不一致，先记录差异并更新对应阶段计划，不得通过修改文档来掩盖代码现状。

## 旧文档清理结论（2026-07-30）

旧文档采用“退出权威入口优先、历史证据保留”的方式清理：

- 仍被现有 V1 代码注释引用的高德、字段映射、Tair 等旧说明保留原路径，但统一降级为 V1/过渡期参考；不得据此定义 V2 的状态、DTO、Top N、TTL、部署平台或降级数字。
- Gate 方案、返修记录、演示报告和旧司机 H5 设计属于历史证据，只证明当时发生过什么，不是继续施工的命令。
- `CLAUDE.md` 暂留根目录作为工具兼容入口；其中与本入口或 `AGENTS.md` 冲突的内容无效。
- `PRODUCT.md`、`docs/demo-v12-*.md` 和 `docs/production-*.md` 均不在当前权威表中；仍需的原则已经进入对应 V2 权威文档。
- 两份会直接驱动错误技术路线、且没有自动化依赖的旧执行文件已删除：
  - `docs/superpowers/specs/2026-07-04-demo-to-production-prompt-template.md`
  - `docs/superpowers/specs/2026-07-04-demo-to-production-upgrade-plan.md`
- Railway 的既有运行记录继续保留，但状态只能是历史 Demo；阿里云目标能力在真实部署验收前不得写成已经具备。

这次清理不移动仍被代码引用的旧文件，避免为了整理文档而制造代码引用断裂。后续若要物理归档，必须先在独立代码阶段解除引用并验证。

# Gate 3-R 状态：migration 指纹前置闸门

> 状态：`FULFILLED_PREPROD_MIGRATION_PASS`
> 更新时间：2026-08-05（Asia/Shanghai）
> 当前步骤编号：`G3R-DB-01`
> 唯一应用候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`

## 1. 纠偏结论

本文件早先基于非最终应用基线统计过 8 个 migration。该统计和对应 checksum 已作废，不得用于迁移、验收或数据库变更。

当前唯一有效事实是：候选 Git 对象内有 9 个 migration。新候选的 Schema blob 与 migration tree 和完成空库演练的旧冻结候选完全相同；最终清单和 checksum 因此继续有效，不能用主工作区未提交文件重算或替换。

- [最终 migration 清单与风险](2026-08-01-gate3-migration-manifest.md)
- [9 个正向 migration SHA-256 清单](2026-08-01-gate3-migrations.sha256)
- 正向清单自身 SHA-256：`a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d`

## 2. 当前授权边界

无需新增云权限即可继续：

- 只读核对候选 Git SHA、migration 路径、文件内容和顺序；
- 审查文档内部一致性；
- 保留、复核本地空库演练与失败现场证据；
- 准备阿里云预生产变更清单和回退步骤。

禁止：

- 连接或修改真实 RDS/Tair；
- 未经单独变更授权在真实 RDS 执行 `prisma migrate deploy`；
- 使用已作废的 8 项清单；
- 把本地空库演练等同于阿里云预生产验收或 Gate 3 PASS。

## 3. 空库演练结果

- 9 个正向 migration：通过；
- 最终 Schema diff：通过；
- 五类数据安全护栏：通过；
- 原始 SHA 的完整逆序 rollback：失败，已保留历史现场；
- 新 SHA 原始 Git 对象的完整逆序 rollback：通过。

原始失败由两项依赖共同造成：`data_model_core` rollback 未解除 `Order_currentAssignmentId_fkey`，V2 rollback 未撤销自己新增的 `User_driverId_fkey` 与 `User.driverId`。两项已提交到最终候选，并从该 SHA 原始 Git 对象通过完整复验；失败现场继续保留，详见[一次性空 PostgreSQL 演练报告](../superpowers/reports/2026-08-01-gate3r-empty-postgresql-rehearsal.md)。

## 4. 下一闸门

本前置闸门已在获准的阿里云预生产变更窗口兑现：目标实例、0805 全量备份、账号权限、网络、冻结制品、9 个 migration 和迁移后对象权限均已通过。实施结果见 [RDS 预生产迁移与最小权限验收](2026-08-05-gate3r-rds-preprod-migration-permissions.md)。

下一步不是重复 migration，而是关闭 owner 长期连接入口，再单独进入 app-only 启动与 readiness 闸门。

大白话：施工图已经在真实预生产库完整执行并验收，不能再重复施工；接下来先收好施工钥匙，再只开应用做健康检查。

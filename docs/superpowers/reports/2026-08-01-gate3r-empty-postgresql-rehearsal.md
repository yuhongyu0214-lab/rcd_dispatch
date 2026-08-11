# Gate 3-R 一次性空 PostgreSQL 演练报告

> 状态：`PASS_FROM_FINAL_CANDIDATE_GIT_OBJECT`
> 日期：2026-08-01（Asia/Shanghai）
> 最终应用候选：`codex/v2-gate3-app-candidate @ 3dea9260865f7e6ed42938d83e370e3823d31a2d`
> 原始失败候选：`7f60fd0d55783d1f057c814e46a3dab7f73e2416`（仅保留历史证据）
> 演练环境：本机隔离 PostgreSQL 18.3；未连接或修改真实 RDS/Tair

## 1. 结论

最终候选原始 Git 对象的 9 个正向 migration、最终 Schema、8 个现有 rollback 和五类数据安全护栏全部通过。原始候选的完整空数据逆序 rollback 链曾失败；该失败现场与错误原文继续保留，不用最终成功覆盖历史。

返修只调整 `20260502120000_data_model_core/rollback.sql` 和 `20260717180000_v2_data_model/rollback.sql` 的外键拆除顺序。9 个正向 migration、最终 Schema、业务代码和依赖均未改变；数据库到最终 Schema 的差异为 0。

大白话：第一次拆库时发现两根外键的拆除顺序不完整；修好后已从新封箱版本重新搭建、拆除和测试安全门，全部通过，同时保留第一次失败现场供追溯。

## 2. 正向 migration 与 Schema

| 验证项 | 结果 | 证据 |
|---|---|---|
| 冻结 Git 对象 | `PASS` | 完整 SHA 与候选分支一致 |
| 正向 migration 数量 | `PASS` | 精确 9 个 |
| Git blob SHA-256 | `PASS` | 9/9 与 `2026-08-01-gate3-migrations.sha256` 一致 |
| 空库前置 | `PASS` | 执行前 `public` 业务表为 0 |
| `prisma migrate deploy` | `PASS` | 9/9 完成，无失败日志 |
| Prisma migration checksum | `PASS` | 数据库记录 9/9 与冻结 Git blob 一致 |
| Prisma Schema 校验 | `PASS` | `prisma validate` 通过 |
| 数据库与最终 Schema diff | `PASS` | `No difference detected`，退出码 0 |
| 最终对象摘要 | 信息 | `public` 表 15、枚举 17、约束 170 |

Windows 工作区检出文件受 CRLF 转换影响，不能直接作为 checksum 输入。本次演练通过 `git cat-file blob` 从冻结提交导出原始字节，再执行 migration；未使用主工作区或转换后的检出副本。

## 3. rollback 验证

### 3.1 原始候选的失败记录

按 `9 → 2` 的顺序执行 8 个现有 rollback：

- `20260726143000_dispatch_event_outbox`：通过；
- `20260719213100_add_internal_source_system_check`：通过；
- `20260719192834_add_internal_source_system`：通过；
- `20260717180000_v2_data_model`：通过；
- `20260704_production_v1`：通过；
- `20260508183000_order_import_v1`：通过；
- `20260508120000_data_model_v1_gap_fix`：通过；
- `20260502120000_data_model_core`：失败并停止。

失败原文：

```text
ERROR: cannot drop table "Assignment" because other objects depend on it
DETAIL: constraint Order_currentAssignmentId_fkey on table "Order" depends on table "Assignment"
```

`20260424155535_init_user` 仍没有 rollback；该已知边界继续采用“失败时保留一次性库并整体重建”的策略，不能声称全链可自动回退。

### 3.2 最终候选的空数据逆序链

从 `3dea9260865f7e6ed42938d83e370e3823d31a2d` 原始 Git blob 创建全新空库并完成 9 个正向 migration 后，按 `9 → 2` 执行全部 8 个现有 rollback，8/8 通过。回退后只剩首个 migration 创建的 `User`、Prisma 记录表 `_prisma_migrations`，公共枚举为 0。

最终指纹如下：

- 9 个正向 migration 清单 SHA-256：`a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d`；
- 全部 17 个 SQL 聚合 SHA-256：`b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f`；
- `data_model_core/rollback.sql`：`581906f6f7755ab3e207b926cd954d3601b268387778b9a5f3a660c9b4845d79`；
- `v2_data_model/rollback.sql`：`c1c20e6285f04a149da7e92bad507e212772c423ab3d84bc2ea787028cc57c8e`。

### 3.3 数据安全护栏

| 护栏反例 | 预期 | 实际 | 失败后事实 |
|---|---|---|---|
| outbox 含事件 | 拒绝删除 outbox | `PASS` | 事件仍为 1 条 |
| `INTERNAL` 来源事件存在 | 拒绝移除枚举 | `PASS` | INTERNAL 事件仍为 1 条 |
| V2-only 业务事实存在 | 拒绝删除 V2 表 | `PASS` | DriverShift 仍为 1 条 |
| OperationLog 含 V2 枚举 | 拒绝收窄枚举 | `PASS` | V2 日志仍为 1 条 |
| `orderNo` 存在重复值 | 拒绝恢复 V1 唯一约束 | `PASS` | 两条同号订单仍保留 |

上述预期失败均由 rollback 事务主动阻断，未发生部分删除。

## 4. 失败现场保留

- 演练根目录：`.gate3r-rehearsal/20260801T090108Z/`；
- PostgreSQL 数据目录、原始失败候选与最终候选导出、归档和运行日志均已保留；
- 原失败库已复制为 `rcd_g3r_rollback_failure_preserved`；最终候选正向库、完整回退库和五类护栏反例库也已保留；停机前共 24 个非模板数据库、约 216 MB，运行日志 24,294 字节；
- 验证结束后 PostgreSQL 正常停止，`127.0.0.1:55432` 不再监听；没有删除或覆盖任何演练数据库；
- 另有一次受沙箱限制的初始化失败目录 `.gate3r-rehearsal/20260801T090041Z/` 原样保留。

未经复验负责人确认，不得删除以上目录或数据库现场，也不得将其加入 Git 提交。

## 5. 返修与最终 Git 对象复验

返修只修改两份 rollback SQL：

1. `20260502120000_data_model_core/rollback.sql` 在删除 `Assignment` 前解除 `Order_currentAssignmentId_fkey`；
2. `20260717180000_v2_data_model/rollback.sql` 撤销该 migration 新增的 `User.driverId` 与 `User_driverId_fkey`。

未使用 `CASCADE`，未修改 9 个正向 migration、Prisma Schema、业务代码或依赖。

| 复验项 | 结果 |
|---|---|
| 新空库 9 个正向 migration | `PASS` |
| 最终 Schema diff | `PASS`，差异为 0 |
| 8 个现有 rollback 逆序执行 | `PASS` |
| rollback 后剩余对象 | 仅 `User` 与 `_prisma_migrations`；公共枚举为 0 |
| 五类数据安全护栏 | `PASS`，失败后事实数量分别为 1/1/1/1/2 |
| 测试 | 446 通过，7 条件跳过 |
| lint / TypeScript / Prisma validate | `PASS` |
| 生产构建 | `PASS` |
| `git diff --check` | `PASS` |

以上结果已再次从最终提交 `3dea9260865f7e6ed42938d83e370e3823d31a2d` 的原始 Git blob 执行，不依赖主工作区或未提交文件。候选 worktree 保持干净。

## 6. 下一步

1. 本次空库演练已完成，不再以原始失败 SHA 作为当前候选；
2. 经用户单独授权后，按 Gate 3-R 基线实施阿里云预生产 RDS/Tair、app、worker、网络、日志和回退闭环；
3. 完成阿里云预生产证据后重新进行 Gate 3 终审；终审通过前不放行第二轮并行。

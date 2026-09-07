# Gate 3-R 状态：RDS 预生产迁移与最小权限验收

> 状态：`RDS_MIGRATION_AND_POSTGRANT_PASS_APP_NOT_STARTED`
> 日期：2026-08-05（Asia/Shanghai）
> 目标数据库：仅 `rcd_v2_preprod`
> 应用候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`
> 固定镜像：`sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d`（`linux/amd64`）
> 非权威范围：本文件只记录实施状态与证据，不修改 Schema、权限规则、HTTP 契约或生产架构

## 1. 结论

阿里云 RDS PostgreSQL 15.17 的独立预生产库 `rcd_v2_preprod` 已完成迁移前备份、身份与权限预检、冻结的 9 个 migration、迁移后对象授权和失败关闭验收。数据库迁移与权限子闸门 `PASS`。

- 2026-08-05 手工全量备份已完成，时间晚于预生产库创建时间，并确认可用于恢复该数据库；
- 目标数据库、owner、app/worker 角色属性和旧库清单只读预检通过；
- 9 个 migration 全部完成，9 条 `_prisma_migrations` 记录均已结束、未回滚、日志为空；
- 15 张表中包含 14 张业务表和 `_prisma_migrations`，所有表 owner 均为 `rcd_v2_preprod_owner`；
- 当前 Schema 不产生 sequence，14 张业务表在迁移后仍为空；
- app 只获得冻结白名单内的逐表 DML，不持有 DDL、`DELETE`、`TRUNCATE`、迁移历史或 sequence 权限；
- worker 无数据库、schema、表或 sequence 权限；
- app、worker、Nginx 均未启动，Gate 3 仍为 `NOT_PASS`，第二轮并行继续冻结。

大白话：数据库结构和应用账号的“钥匙”已经按清单配好。应用只能碰批准的业务表，worker 没有数据库钥匙，应用本身还没有开机。

## 2. 迁移制品与失败关闭证据

| 证据 | 结果 |
|---|---|
| Schema SHA-256 | `ebbcfbf0df0caf6b87f342bd27a195f422bfc0d2134fffb7484a03dd6fbcd1af` |
| 正向 migration | 9 |
| rollback | 8 |
| SQL 文件总数 | 17 |
| Git blob Prisma 归档 SHA-256 | `505a4c11d75c523ad59c1a6cafad051146de202f7da029b5a59f93553100b305` |
| 迁移容器 | `rcd-v2-preprod-migration-20260805T150801Z` |
| 迁移后授权 SQL SHA-256 | `425fe5f4b93b474c8309936d48a6fb9667f39492e849860267d5fbe1e0a17e32` |
| 失败关闭验收 SQL SHA-256 | `2a13c9175edf1b8ee06898c22dd2c17bc2bf0ae52175dc72d3c0ca3490643662` |
| 对象授权容器 | `rcd-v2-preprod-postgrant-20260805T152338Z` |
| 权限验收容器 | `rcd-v2-preprod-postgrant-validation-20260805T152338Z` |

镜像内 Prisma 文本受 Windows checkout 的 CRLF 影响，第一次制品校验得到 Schema SHA-256 `ebf0e72a31095e4505cb654a548b5f3ea70c00b9d236691925cf8799827e3d8d`，与冻结 Git 对象不一致。安全脚本在任何 migration 之前以 `SCHEMA_CHECKSUM_MISMATCH` 停止，未放宽校验、未修改数据库，并保留失败制品现场。随后从完整提交 `492c86ea…429ab5` 提取原始 Git blob，按只读方式挂载到同一固定镜像，制品校验通过后才执行 migration。

该过程证明 checksum 护栏真实生效，不把“内容看起来一样”当成冻结制品一致。

## 3. 最小权限验收

失败关闭 SQL 已逐项断言并通过：

- app：数据库仅 `CONNECT`，`public` schema 仅 `USAGE`，业务表权限逐表匹配冻结白名单；
- app：不能访问 `_prisma_migrations`，没有 `DELETE / TRUNCATE / REFERENCES / TRIGGER`；
- worker：无数据库连接权、schema 权限、表权限和 sequence 权限；
- PUBLIC、app、worker 不在 owner 的未来表/sequence 默认 ACL 中；
- 所有 `public` 表均由 owner 持有，sequence 数量为 0；
- RDS app、migration owner、Tair 内网 `PING` 和高德服务端 IP 探针均已通过受控登录检查，秘密值未写入状态文档。

最终标记：

```text
RDS_POSTMIGRATION_VERIFY_PASS
RDS_POSTGRANT_VALIDATION_PASS
RDS_POSTGRANT_PASS
```

## 4. 当前停止点与下一闸门

已完成：ECS 当前候选按完整 digest 拉取与平台/revision 核验、受控环境文件准备、RDS/Tair 白名单与只读登录检查、0805 全量备份、9 个 migration 和迁移后权限验收。

尚未完成：

1. 关闭 migration 任务并移除 owner 的长期连接入口；不能把 owner 连接交给 app/worker；
2. 单独批准并只启动 app，验证匿名 liveness 与受保护 readiness；
3. app 通过后再启动 HTTP-only 单副本 worker；
4. worker 通过后再启动 Nginx/入口，并完成日志、真实锁竞争、真实 ETA、outbox 和关键业务冒烟；
5. 完成预生产证据包和 Gate 3 独立终审。

本文件不授权上述后续操作，也不表示阿里云正式生产已经上线。

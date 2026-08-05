# Gate 3-R 基础设施基线状态

> 状态：`RDS_SUBGATE_PASS_RUNTIME_PENDING`
> 日期：2026-08-05（Asia/Shanghai）
> 权威架构：[基础设施架构 V2](../versions/v2.0/infrastructure-v2.md)
> 权威决策：[基础设施决策日志](../versions/v2.0/infrastructure-decision-log.md)
> 资源证据：[阿里云只读资源盘点](../superpowers/reports/2026-07-30-aliyun-readonly-inventory.md)

## 已确定

- 中国大陆正式生产主线使用阿里云；Railway 只保留历史 Demo 证据。
- 第一版使用单 ECS + Docker + Nginx，运行同一镜像的 app、HTTP-only 单副本 worker 和一次性 migration。
- RDS PostgreSQL 是唯一业务事实库；Tair/Redis 只保存实时位置、在线状态、ETA 短缓存和短锁。
- ACR 保存不可变镜像，SLS 集中保存结构化运行日志；当前没有文件业务，第一版不启用 OSS。
- 正式地域跟随正式 RDS；设计目标为 RPO 不超过 5 分钟、RTO 不超过 2 小时。
- 数据保留基线：司机历史位置 90 天、业务操作审计 1 年、运行日志 30 天、安全审计 180 天。

## 已核验或已批准的现状

| 对象 | 当前状态 | 使用边界 |
|---|---|---|
| 现有 RDS | 上海；独立预生产库 `rcd_v2_preprod` 已完成 0805 全量备份、9 个 migration 与迁移后最小权限验收 | 仅批准复用为 V2 预生产；正式生产另建物理实例；不得重复 migration |
| 现有 Tair | 上海；Redis 7.0、标准 1GB、VPC、跨可用区主备；内网登录与 `PING` 已通过 | 仅批准复用为 V2 预生产；app 固定前缀 `rcd:v2:preprod:`，worker 不持有连接 |
| ECS | 上海预生产实例已核对：Ubuntu 26.04 amd64、2C2G/40GiB；Docker 与 `rcdops` 非 root 管理已验收；当前、上一与回退镜像均已按 digest 保留；一次性 migration 已完成 | app/worker/Nginx 尚未启动；先关闭 migration owner 长期入口，再分阶段启动并验收 |
| ACR | 当前 `492c86e…@sha256:fb1237…d27d`、上一 `7378303…@sha256:1292f8…af57` 与回退 `169f2ad…@sha256:6e3799…2674` 均已在 ACR/ECS 核验；未创建 `latest` | ECS 只按获准完整 digest 运行；三份镜像继续保留 |
| SLS | 尚未开通 | 按缺失处理，实施前确定预算、保留期和告警责任人 |
| 域名/ICP/证书 | 尚未完成核验 | 阻断正式公网生产入口 |
| Railway | 有历史 app/worker Demo 运行记录 | 不能作为生产架构、部署或 Gate 3 PASS 证据 |

## 当前阻断项

1. 关闭 migration 任务并移除 owner 的长期连接入口；owner 不得进入 app/worker。
2. 单独启动 app 并通过匿名 liveness、受保护 readiness 和登录安全验收。
3. 唯一本地候选已更新为 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`；其 Schema/migration tree 与完成空 PostgreSQL 演练的旧候选完全相同，原有 9 个正向 migration、最终 Schema、8 个 rollback 和五类数据安全护栏结论继续有效。
4. 冻结秘密托管产品、所有者、轮换周期、应急吊销人和维护窗口。
5. 当前、上一与回退镜像追溯和 ECS 拉取已经通过；预生产 9 个 migration 与迁移后权限子闸门已经通过，仍须 app/worker/edge、SLS、关键链路和回退验收。
6. 完成阿里云预生产闭环后重新进行 Gate 3 终审。

预生产应用可部署性、资源复核、秘密变量、变更顺序和回退证据见[阿里云预生产准备包](2026-08-01-gate3r-aliyun-preproduction-preparation.md)。当前、上一与回退 [ACR 镜像](2026-08-02-gate3r-acr-image-publication.md) 已在 ECS 按 digest 保留；[RDS 迁移与权限子闸门](2026-08-05-gate3r-rds-preprod-migration-permissions.md)已通过。下一步先关闭 migration owner 长期入口，再单独申请 app-only 启动与 readiness 验收。

本状态文件不授权创建、修改、删除或续费任何云资源，也不表示生产已经上线。

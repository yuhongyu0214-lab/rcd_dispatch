# Gate 3-R 基础设施基线状态

> 状态：`FROZEN_CURRENT_IMAGE_AWAITING_ECS_PULL`
> 日期：2026-08-03（Asia/Shanghai）
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
| 现有 RDS | 上海；已有备份证据 | 仅批准复用为 V2 预生产；正式生产另建物理实例 |
| 现有 Tair | 上海；Redis 7.0、标准 1GB、VPC、跨可用区主备 | 仅批准复用为 V2 预生产；前缀代码已进入唯一候选，仍须完成权限、续费和连接验收后才能注入 |
| ECS | 上海预生产实例已核对：Ubuntu 26.04 amd64、2C2G/40GiB；Docker 与 `rcdops` 非 root 管理已验收，上一与回退镜像已按 digest 拉取；当前镜像待拉取，无运行容器 | 只能写成“主机与旧镜像已准备”，不得写成应用已部署；恢复登录后重新核验磁盘并拉取当前 digest，秘密、依赖连接、migration、启动和日志实施仍须独立闸门 |
| ACR | 当前 `492c86e…@sha256:fb1237…d27d`、上一 `7378303…@sha256:1292f8…af57` 与回退 `169f2ad…@sha256:6e3799…2674` 均已核验；未创建 `latest` | ECS 只按获准完整 digest 拉取；三份镜像继续保留 |
| SLS | 尚未开通 | 按缺失处理，实施前确定预算、保留期和告警责任人 |
| 域名/ICP/证书 | 尚未完成核验 | 阻断正式公网生产入口 |
| Railway | 有历史 app/worker Demo 运行记录 | 不能作为生产架构、部署或 Gate 3 PASS 证据 |

## 当前阻断项

1. 在首次资源写入前复核 RDS/Tair 续费成功与新到期时间。
2. 独立核验预生产库、账号、最小权限、VPC/交换机/安全组和 RDS/Tair 网络互通。
3. 唯一本地候选已更新为 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`；其 Schema/migration tree 与完成空 PostgreSQL 演练的旧候选完全相同，原有 9 个正向 migration、最终 Schema、8 个 rollback 和五类数据安全护栏结论继续有效。
4. 冻结秘密托管产品、所有者、轮换周期、应急吊销人和维护窗口。
5. 当前、上一与回退镜像追溯已经通过；Compose 命令修正已完成完整回归、提交、普通推送和 ACR 新镜像追溯，仍须 ECS 拉取当前 digest 与后续预生产实施验收，之后才可申请 migration 或容器启动。
6. 完成阿里云预生产闭环后重新进行 Gate 3 终审。

预生产施工前的应用可部署性、资源复核、秘密变量、变更顺序和回退证据已整理为[阿里云预生产准备包](2026-08-01-gate3r-aliyun-preproduction-preparation.md)。当前、上一与回退 [ACR 镜像](2026-08-02-gate3r-acr-image-publication.md) 已追溯，上一与回退镜像已在 ECS 保留；下一步是恢复 `rcdops` 登录后按当前 digest 拉取镜像，再复核 SLS/网络/秘密清单并单独申请写入授权。

本状态文件不授权创建、修改、删除或续费任何云资源，也不表示生产已经上线。

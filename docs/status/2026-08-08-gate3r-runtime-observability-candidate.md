# Gate 3-R 状态：ECS 运行与可观测性候选

> 状态：`APP_WORKER_EDGE_SLS_BASE_DATA_PASS_BUSINESS_E2E_PENDING`
> 日期：2026-08-08～2026-08-09（Asia/Shanghai）
> 证据来源：本地候选审查与回归、Git/ACR 核验、ECS 部署脚本、外部健康检查、SLS 控制台查询与告警验收、G3E2E R2.2 基础资料写入与 app 身份核验
> 非授权范围：本状态不授权重复 migration、SLS 开通、业务写入、正式域名、Git 提交/推送或第二轮并行

## 1. 当前不可变候选

| 项目 | 当前事实 |
|---|---|
| 分支 | `codex/v2-gate3-app-candidate` |
| Git SHA | `4eb3b4857caae9730eb70dd9f2fb152bd8972ca0`，本地与远程一致 |
| ACR/ECS digest | `sha256:9ec8265b971453edd73bc4e0ea882c3d8665ed46beabf78756d03409e80c962f` |
| 平台 | `linux/amd64` |
| 镜像 revision | `4eb3b4857caae9730eb70dd9f2fb152bd8972ca0` |
| 首选应用回退 | `084649f498c7bce3c1418c2a5d9273282b085efc@sha256:4664fc50cbd1a6bf08e24e99447d2f03097e3d21a74fcdaa80d2c2c432b05947` |
| 配置备份 | `/srv/rcd-dispatch/backups/observability-20260808T084553Z` |
| ECS 证据日志 | `/home/rcdops/evidence/observability-update-20260808T084553Z.log` |

迁移期候选 `492c86ea51b40da9426b8ad5b6aef861aa429ab5@sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d` 与更早候选继续保留用于历史追溯，不得冒充当前运行身份。

## 2. 代码与构建验收

- 本轮只修改部署说明、Compose、Nginx 日志模板、部署制品测试、worker logger 与 app logger。
- `466` 项测试通过，`7` 项条件跳过；lint、TypeScript、生产构建、Compose 解析、Nginx 语法与 `git diff --check` 通过。
- Git 采用普通快进推送，无 force、rebase、amend 或分支合并。
- 外部 HTTP 方法、路径、鉴权、DTO、状态码、错误码和 `traceId` 语义未改变。
- Prisma Schema、9 个 migration、rollback、领域枚举、设计变量和依赖版本未改变；不得对 `rcd_v2_preprod` 重复执行 migration。

## 3. ECS 运行验收

| 检查项 | 结果 |
|---|---|
| app | 新 revision，`healthy` |
| HTTP-only 单副本 worker | 新 revision，`healthy`；无数据库、Redis 或高德凭据 |
| Nginx | 新 revision，运行中 |
| app 3000 | 未对公网发布 |
| HTTP | `308` 跳转 HTTPS |
| HTTPS health | ECS 本机与外部网络均为 `200` |
| HTTPS admin login | 外部网络为 `200` |
| worker 内部处理路由 | 公网为 `404` |
| migration | 没有运行中的 migration 容器，未重复迁移 |

当前仍使用公网 IP 自签名证书，只能称为预生产演示，不代表浏览器受信任 HTTPS 或正式上线。

## 4. 本机日志护栏

- app、worker、Nginx 都携带 `environment`、`service`、完整 `revision`、`time` 和字符串 `level`；请求链路按适用场景携带 `traceId`。
- Nginx 访问日志不记录 query string、Cookie、Authorization 或请求 body。
- app、worker、Nginx 均使用 Docker `json-file`，单文件 `20m`、最多 `5` 个文件。
- worker 与 Nginx 已在真实容器输出中验证结构化 `service` 和完整 `revision`。

上述 ECS 本机护栏继续有效；集中采集与查询结果见下一节。

## 5. SLS 集中采集验收

SLS 子闸门已经 `PASS`：

- Project：`rcd-v2-preprod-sh-uf6b`；运行日志 Logstore 为 `runtime`，安全日志 Logstore 为 `security`。
- LoongCollector `3.2.6` 已安装并运行，ECS 机器组心跳正常。
- Docker stdout 采集配置 `runtime-docker-stdout` 只采集 app、worker、Nginx 三个容器；migration 与 LoongCollector 日志未混入 `runtime`。
- JSON 展开后的 `level`、`environment`、`service`、`revision`、`traceId` 和 `msg` 可检索；app、worker、Nginx、完整 revision、环境/级别和真实 traceId 查询均已返回对应日志。
- `runtime` 保留 30 天；`security` 保留 180 天。`security-auth-log` 已采集 `/var/log/auth.log`，`security_pipeline_test`、`sshd` 和 `sudo` 查询通过。
- 数据库连接、Redis、会话、高德服务端 Key、Authorization、Cookie 和 password 等敏感关键词查询均无匹配内容。
- `rcd-v2-preprod-worker-heartbeat` 与 `rcd-v2-preprod-ssh-auth-failure` 两条日志告警已建立，一条费用预算已建立。
- 通知通道已使用无害测试事件验收；测试后已恢复正式查询和阈值，恢复后的告警历史显示规则执行成功且未误触发。

SLS 只保存运行与安全排障日志，不代替 PostgreSQL 中的业务操作审计。

## 6. G3E2E R2.2 隔离基础资料

G3E2E R2.2 基础资料子闸门已经 `PASS`：

- 冻结包 `G3E2E-BOOTSTRAP-R2.2-SHANGHAI` 的 ZIP SHA-256 为 `e19503c45d64364205f49953b7293540b1c885413fca9fed67fd320c6f9e40ea`，业务内容 SHA-256 为 `654ef049d9b5a9a2c7f341246583af03b5d7a10987f18c2c7767ecb86d300b52`。
- 已写入并由 app 身份精确核验 `3` 个门店、`6` 个用户、`5` 名司机和 `8` 台车辆；班次、位置样本和订单仍为 `0`。
- 冻结兼容触发器把首次写入的司机 `onShift` 派生为 `true`；经单独批准，仅将这 `5` 名标记司机的 `onShift` 原子修正为 `false`，其余字段未改，最终 `contentExactMatch=true`。
- owner 旧凭据已拒绝、临时连接文件已删除，运行容器未改变；当前数据库不得重复整批写入。

完整执行证据与复用边界见 [G3E2E R2.2 隔离基础资料写入与核验](2026-08-09-gate3r-g3e2e-base-data-bootstrap.md)。

## 7. 下一步与停止条件

```text
调度员与司机真实登录
→ H5/API 班次与位置上报
→ 10 单业务端到端与并发验收
→ 故障和应用回退演练
→ Gate 3 终审
```

业务事实安全不明或回退目标不可验证时立即停止。Gate 3 继续 `NOT_PASS`，第二轮并行继续 `FROZEN`。

## 8. 大白话

新版本、后台任务、入口和集中日志已经形成一条可追溯链路。隔离测试所需的门店、账号、司机和车辆也已安全写入并逐项核对，临时数据库 owner 已关掉。下一步不再重复导入基础资料，而是让测试角色真实登录、上班、上报位置，再写入冻结的 10 个测试订单并验证调度流程。

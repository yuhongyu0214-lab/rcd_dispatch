# Gate 3-R 阿里云预生产准备包

> 状态：`BLOCKED_BEFORE_MIGRATION_AND_CONTAINER_START`
> 日期：2026-08-02（Asia/Shanghai）
> 唯一本地应用候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`
> 正向 migration 清单 SHA-256：`a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d`
> 全部 17 个 SQL 聚合 SHA-256：`b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f`

## 1. 当前结论

本地空库、Schema、rollback、数据安全护栏和镜像追溯子闸门已经通过。Git 远程与 ACR 当前镜像均对应 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`，digest 为 `sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d`；上一 `7378303…@sha256:1292f8…af57` 与回退 `169f2ad…@sha256:6e3799…2674` 完整保留。ECS 已安装 Docker、建立 `rcdops` 管理账号并拉取上一与回退镜像，但当前镜像尚未拉取；秘密、RDS/Tair 连接、SLS、应用启动和数据库 migration 尚未实施。

当前候选已确认 9 个正向 migration 与 Schema 原始字节零变化，462 项测试、7 项条件跳过，lint、类型检查、Prisma、生产构建与依赖审计全部通过；部署命令已经显式携带 `--env-file` 与 `-f deploy/compose.preprod.yml`，并形成新 SHA/ACR 镜像。恢复 ECS 登录后只允许准备部署目录、权限、环境变量模板并按 digest 拉取当前镜像，不得执行 migration、注入秘密或启动容器。之后仍须核对网络、秘密、HTTPS、SLS、责任人与费用上限。

大白话：完整启动命令和新镜像已经准备好，服务器里暂时还是上一箱和备用箱。等恢复登录后先把新箱子拉下来，再摆好目录和空白配置；不能碰数据库或开应用。

## 2. 资源事实与待复核项

以下状态来自 2026-07-31～2026-08-01 已保存的只读盘点，不冒充变更窗口当天的实时事实。本轮尝试通过已登录 Chrome 重新读取控制台，但 RDS 重页面连续超时，未取得新的权威页面状态，也未产生任何云端修改。用户已报告 `rcd_v2_preprod` 和 RDS/Tair app/worker 账号已创建；在独立只读核验前只记为待确认事实，不重复创建。

| 对象 | 已知状态 | 变更窗口前必须复核 |
|---|---|---|
| RDS PostgreSQL | 上海现有实例；用户报告 `rcd_v2_preprod` 与分角色账号已创建；权限 SQL/migration 未执行 | 独立核验新库/账号、实例运行、版本、VPC/交换机、剩余空间、自动备份、最新恢复点、续费结果 |
| Tair/Redis | 上海现有实例；用户报告分角色账号已创建；前缀代码已进入当前候选，真实连接未验收 | 独立核验账号、实例运行、续费结果、VPC/交换机、内存与淘汰策略 |
| ECS | 上海预生产实例已核对：Ubuntu 26.04 amd64、2C2G/40GiB；SSH 来源收敛；Docker Engine/Compose 已安装，`rcdops` + `sudo` 已验收，上一与回退镜像已按 digest 拉取；当前镜像待拉取，未启动容器 | 恢复登录后重新核验磁盘，继续准备受控部署目录、权限和变量模板并拉取当前 digest；秘密/RDS/Tair/migration/启动仍需后续闸门 |
| ACR | `492c86e…@sha256:fb1237…d27d` 当前镜像、`7378303…@sha256:1292f8…af57` 上一镜像与 `169f2ad…@sha256:6e3799…2674` 回退镜像均已远端核验，未创建 `latest` | ECS 只按当前完整 digest 拉取；现有三份镜像继续保留 |
| SLS | 尚未开通 | 预算、Project/Logstore、30 天运行日志、180 天安全日志、费用告警 |
| 高德 API | 用户报告所需 Key 已取得；尚未在预生产按角色注入或完成连通验收 | 服务端 Key 只给 app；前端 JS Key/安全码只作公开构建配置；核对域名限制与真实 ETA 探针 |
| 域名/证书 | 未核验 | 预生产是否只走受限入口；若公网访问，必须明确域名、HTTPS 和访问来源 |
| RAM/责任人 | 当前盘点来自主账号视角 | 实施账号、审计人、回退决定人、秘密轮换人和费用告警接收人 |

停止条件：续费或备份无法确认、需要开放 RDS/Tair 全网白名单、目标实例或地域不明确、需要把秘密写入聊天/Git/镜像/日志时，立即停止。

## 3. 应用可部署性闸门（先于云资源写入）

### 3.1 收口结果

| 编号 | 级别 | 事实 | 完成标准 |
|---|---|---|---|
| PRE-P0-01 | `PASS` | 新候选具备 Dockerfile、`.dockerignore`、Compose、Nginx 和 app/worker/migration 三角色定义；ACR 镜像按 commit SHA/digest 追溯 | ECS 只能引用本轮核验的完整 digest |
| PRE-P0-02 | `PASS` | V2 liveness/readiness 已实现并测试，匿名入口不暴露依赖，内部 readiness 受保护 | 预生产运行后复核真实依赖与公网边界 |
| PRE-P1-01 | `PASS` | standalone 构建、静态资源、Prisma Client、OpenSSL/CA、非 root 与健康检查已完成容器验证 | ECS 运行时重复冒烟 |
| PRE-P1-02 | `PASS_STATIC` | 同一镜像定义一次性 `prisma migrate deploy`，app/worker 启动不自动迁移 | 真实 RDS migration 仍需独立授权和窗口 |
| PRE-P1-03 | `PARTIAL` | Nginx 与 stdout 日志边界已定义；SLS 尚未实施 | ECS/SLS 实施后验证查询、脱敏、保留期和告警 |

### 3.2 候选返修边界

部署返修已按本边界形成新 SHA `492c86ea51b40da9426b8ad5b6aef861aa429ab5`；未修改业务状态机、HTTP 业务契约、领域枚举、Prisma Schema、9 个正向 migration、调度核心或第二轮功能。已验证：

1. `pnpm test`、lint、TypeScript、Prisma validate、生产构建和依赖审计；
2. 容器镜像可分别启动 app、单副本 HTTP-only worker 和一次性 migration；
3. migration 文件数量仍为 9，正向清单 SHA-256 仍为本页顶部数值；
4. `/api/v2/health` 匿名只返回存活信息，readiness 未授权返回 401，授权时核对 db/redis/amap；
5. 镜像层、构建日志、运行日志和版本控制中不出现任何秘密。

## 4. 推荐的预生产隔离方案

为避免覆盖现有历史库，推荐在现有预生产 RDS 实例上创建新的专用数据库和分角色账号；不删除、改名或清空现有 `rcd_dispatch`、`postgres`、shadow 库及历史数据。该推荐属于待批准实施方案，不表示数据库已创建。

| 边界 | 推荐值/规则 |
|---|---|
| 数据库 | 复用并独立核验用户已报告创建的 `rcd_v2_preprod`；不得另建同用途数据库 |
| app 数据库账号 | 复用并核验 `rcd_v2_preprod_app`；按逐表运行需求授权，不持有通用 DDL/超级权限 |
| migration/owner 账号 | `rcd_v2_preprod_owner` 只在迁移窗口使用；不注入 app/worker，完成后撤销长期连接入口 |
| Redis/Tair | 现有预生产实例上的独立账号或等价最小权限边界；固定 `REDIS_KEY_PREFIX=rcd:v2:preprod:` |
| ECS | 上海、与 RDS/Tair 同 VPC；单 ECS 仅作为已批准的成本优先预生产，不宣称高可用 |
| app/worker | 同一镜像 digest；app 常驻，worker 单副本且不注入 DATABASE_URL、REDIS_URL 或高德服务端 Key |
| worker origin | 优先在 ECS/Docker 内网调用 app；内部密钥放 Authorization header，不进入 URL/日志 |
| 日志 | SLS 收集 Nginx/app/worker/Docker/系统日志；运行日志 30 天、安全日志 180 天 |
| 公网入口 | 非预生产数据库验收必需；若开放给验收人员，必须 HTTPS、限制来源、关闭公开注册和演示凭据 |

如果阿里云产品限制导致无法创建独立数据库或独立 Tair 账号，必须停止并重新裁决，不能默默复用旧账号或通过 Key 前缀冒充权限隔离。

## 5. 秘密与变量准备矩阵

本表只登记名称和边界，不保存值。真实值只能在获准秘密系统或受控环境中生成、注入和轮换。

| 变量 | app | worker | migration | 准备规则 |
|---|:---:|:---:|:---:|---|
| `DATABASE_URL` | 是 | 否 | 否 | 使用 app 最小权限账号 |
| migration 数据库连接 | 否 | 否 | 是 | 单独临时 DDL 账号，不复用 app URL |
| `SHADOW_DATABASE_URL` | 否 | 否 | 否 | `migrate deploy` 不需要；不得指向生产或预生产事实库 |
| `REDIS_URL` | 是 | 否 | 否 | 使用预生产专用账号/权限 |
| `REDIS_KEY_PREFIX` | 是 | 否 | 否 | 固定 `rcd:v2:preprod:` |
| `AUTH_SESSION_SECRET` | 是 | 否 | 否 | 独立随机值，有轮换与吊销责任人 |
| `DRIVER_JWT_SECRET` | 是 | 否 | 否 | 与会话、worker 密钥分离 |
| `INTERNAL_CRON_SECRET` | 是 | 是 | 否 | app 与 worker 共享此单一用途秘密 |
| `DISPATCH_EVENT_WORKER_ORIGIN` | 否 | 是 | 否 | 只含安全 origin，不含路径、查询参数或凭据 |
| `AMAP_SERVER_KEY` | 是 | 否 | 否 | 仅服务端 app |
| `NEXT_PUBLIC_AMAP_JS_KEY` / `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 构建/运行 | 否 | 否 | 公开渲染配置仍按高德域名限制管理 |
| `INGEST_API_KEY` / `INGEST_API_KEY_SOURCE` | 是 | 否 | 否 | 每个凭证只绑定一个来源 |
| `CORS_ORIGINS` | 是 | 否 | 否 | 只列获准来源，不使用 `*` |
| `ALLOW_PUBLIC_ADMIN_REGISTRATION` | 是 | 否 | 否 | 固定 `false` |
| `LOG_LEVEL` | 是 | 是 | 可选 | 预生产默认 `info`，不得开启秘密原文日志 |

## 6. 获准后的变更顺序

```text
0. 确认新候选 SHA、镜像构建通过、migration 正向指纹未变
1. 只读复核 RDS/Tair 续费、地域、VPC、备份和恢复点
2. 冻结维护窗口、操作者、审计人、回退决定人和费用上限
3. 创建/配置 ACR、SLS、ECS 与最小网络边界
4. 独立核验已报告创建的 `rcd_v2_preprod` 与分角色账号；存在则直接复用，不重复创建，不动旧库
5. 独立核验已报告创建的 Tair 预生产账号，验证前缀与最小网络访问
6. 构建一次镜像并推送 ACR，记录 commit、tag、digest 和上一稳定版本
7. 仅运行一次 migration；核对 9 条记录、checksum、Schema 和对象所有权
8. 撤销临时 migration 权限，启动 app，验证 liveness/readiness
9. 启动单副本 HTTP-only worker，连续验证每分钟调用和十分钟基线桶
10. 验证登录面、Redis 锁、真实 ETA、不造假降级、outbox、日志脱敏和关键冒烟
11. 观察窗口通过后冻结预生产证据包；失败则停止，不继续 Gate 3
```

截至 2026-08-03，步骤 0 的工程、migration、Compose 命令修正、Git 远程与 ACR 当前镜像追溯已经完成；步骤 3 已完成 ECS Docker/管理员账号和上一/回退镜像准备，当前镜像拉取、SLS、秘密、RDS/Tair、migration 与运行实施未完成。步骤 6 的镜像构建/推送已完成，ECS 按 digest 拉取与核验待恢复登录后执行。

## 7. 回退与失败现场

- 云资源创建失败：保留操作日志和费用状态，不反复点击创建；按明确目标逐项回收，回收本身需要单独确认。
- migration 未提交失败：停止新 app/worker，保留数据库和日志现场，不删除重试证据。
- migration 已提交但应用失败：优先回退镜像或前向修复；不得默认执行破坏性数据库 rollback。
- rollback 被安全护栏阻断：保持数据原样，升级人工裁决，不清空 outbox 或业务事实。
- RDS/Tair 需全网白名单才能连接：停止，不以 `0.0.0.0/0` 临时绕过。
- 任何秘密出现在日志、截图、聊天或镜像层：先吊销/轮换，再继续调查。

## 8. 预生产验收证据包

- 新候选完整 SHA、分支、代码审查与工程检查；
- 9 个正向 migration 指纹未变的证明；
- ACR tag/digest、ECS 与网络脱敏标识、SLS 查询证据；
- RDS/Tair 变更前备份/恢复点、账号与权限、网络连通证据；
- migration 开始/结束、9 条记录/checksum、Schema diff、对象所有权；
- app liveness、受保护 readiness、登录安全和关键业务冒烟；
- worker 连续周期、十分钟基线、outbox 处理与积压；
- Redis 锁竞争/降级、高德成功/无路径/可控故障；
- 日志脱敏、费用/容量、失败现场和回退决定；
- 未完成项以及 Gate 3 `PASS` / `REQUEST CHANGES` 结论。

## 9. 下一项需要批准的动作

部署 README 与对应测试修正已经专项/完整复验、提交、普通推送并形成当前 ACR 镜像。当前可以继续做的最小动作，是恢复 `rcdops` 登录后准备 ECS 部署目录、权限和不含秘密值的环境变量模板，并按完整 digest 拉取当前镜像。在另行批准前不得执行 migration、注入秘密、连接真实依赖或启动容器。

上述准备材料复核通过后，再单独申请 ECS、SLS、网络和后续 RDS/Tair/migration 的逐项写入授权。已经完成的 ACR 镜像发布不自动扩大授权范围；授权仍须列明对象、操作、地域、费用和停止条件，不能用一句“全部允许”替代。

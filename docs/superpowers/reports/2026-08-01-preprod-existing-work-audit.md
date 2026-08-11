# Gate 3-R 预生产既有成果去重审查

> 结论：`REQUEST_CHANGES_BEFORE_PREPROD_EXECUTION`
> 日期：2026-08-01（Asia/Shanghai）
> 当前应用候选：`codex/v2-gate3-app-candidate @ 3dea9260865f7e6ed42938d83e370e3823d31a2d`
> 审查输入：`7f60fd0d55783d1f057c814e46a3dab7f73e2416`、`8deb2da3e7448f81a61784ae33936c35f46fe678`、基建文档提交 `2653dedc976486b290db684648f2a1d1ba787678`
> 云端边界：本次没有连接或修改真实 RDS/Tair，没有执行云端 SQL、迁移或秘密注入

## 1. 去重结论

### 已完成并由当前候选继承，不重做

| 成果 | 证据 | 裁决 |
|---|---|---|
| HTTP-only worker | `7f60fd...` 是 `3dea926...` 的祖先；当前 worker 只读取 `DISPATCH_EVENT_WORKER_ORIGIN`、`INTERNAL_CRON_SECRET` 和 `LOG_LEVEL` | 保留；worker 不配置数据库、Redis 或高德秘密 |
| Tair 统一前缀 | `8deb2da` 是 `3dea926...` 的祖先；当前 `redis.ts` 全部 Key、SCAN、Pipeline 和 Lua 路径经 `redisKey()` | 保留；不重新实现前缀 |
| Redis 冷启动 | 当前候选在 `8deb2da` 之后又增加冷启动就绪修复 | 保留；当前实现优于旧专项基线 |
| 实时 TTL | 当前候选的最新位置与在线状态统一为 180 秒 | 保留 |
| 旧 Tair 变量清场 | 当前候选对 `TAIR_URL/TAIR_PASSWORD/TAIR_DB/TAIR_POOL_*` 为零引用 | 保留；只认 `REDIS_URL` 与 `REDIS_KEY_PREFIX` |
| migration 内容 | 当前候选仍为 9 个正向 migration；最终正向清单 SHA-256 为 `a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d` | 不重写 migration |

当前候选重新执行 Redis、冷启动和 worker 专项：3 个文件、43/43 通过，其中 Redis 37、冷启动 2、worker 4。

### 已有方案，可复用但必须先返修

`2653ded` 的数据库权限方案已经覆盖数据库名/owner 检查、`PUBLIC` 收紧、app DML、worker 无连接、Prisma 迁移表隔离、表/sequence 分别授权以及只回收权限的回退。总体架构方向正确，不再另写一套平行 SQL。

该提交不在当前应用候选祖先链，且文件明确标注 `DRAFT FOR REVIEW / NOT EXECUTED`。它是基建施工输入，不是“权限已在 RDS 生效”的证据。

## 2. 权限方案独立复验

在一次性本地 PostgreSQL 18.3 中，以 `2653ded` 原始 SQL 和当前候选原始 9 个 migration 复验：

| 验证项 | 结果 |
|---|---|
| 迁移前权限基线 | `PASS` |
| 9 个 `prisma migrate deploy` | `PASS` |
| 迁移后对象授权 | `PASS` |
| app 对 14 张业务表 SELECT/INSERT/UPDATE/DELETE | `PASS` |
| app CREATE schema/table | 正确拒绝 |
| app 读取 `_prisma_migrations` | 正确拒绝 |
| worker 连接 `rcd_v2_preprod` | 正确拒绝 |
| 业务表与迁移表 owner | 均为 `rcd_v2_preprod_owner` |
| app 危险表权限 TRUNCATE/REFERENCES/TRIGGER | 0 |
| worker 表/sequence 权限 | 0 |

本地验证现场保存在 `.gate3r-preprod-permission-review/20260801T102500Z/`，数据库已正常停止，未删除现场。

## 3. 审查发现

### P0：应用候选仍不可按冻结架构部署

当前候选没有 Dockerfile、`.dockerignore`、Nginx、ACR 构建及 app/worker/migration 三角色运行定义；同时缺少契约规定的匿名 `/api/v2/health` 与受保护 `/api/v2/health/readiness`。旧 `/api/health` 匿名返回数据库状态，并在失败时返回底层错误文本。

影响：即使 RDS/Tair 权限准备正确，也不能形成同镜像、可追溯、可健康检查的阿里云预生产发布证据。

### P1：权限回收 SQL 缺少执行账号防误操作检查

权限回收块只校验 `current_database()`，没有校验 `current_user='rcd_v2_preprod_owner'`。本地使用错误执行账号 `postgres` 运行时返回成功，并实际回收 app 的 CONNECT/USAGE/对象权限。

影响：用户描述的“所有变更 SQL 都带目标库和执行账号检查”尚未成立。执行前应补同正向 SQL 一致的双重检查。

### P1：`ON ALL TABLES` 的统一 CRUD 仍大于运行时最小权限

方案对所有业务表统一授予 SELECT/INSERT/UPDATE/DELETE。当前生产代码对 `OperationLog` 只执行 SELECT/INSERT，对 `DriverLocationSample` 只执行 SELECT/INSERT，对 `OrderServicePlan` 和 `Vehicle` 只执行 SELECT；多张事实/历史表没有 DELETE 路径。

影响：应用 bug 或凭据泄露时，可修改/删除本不需要修改的审计与历史事实。应改为逐表权限矩阵，并以 app 账号运行集成冒烟确认没有漏权。

### P1：验收查询是观察型输出，没有失败关闭

现有验收 SQL 会打印布尔值和 ACL 行，但不在发现缺权、越权、owner 错误或默认权限错误时主动抛错。人工漏看一行仍可能继续启动 app。

影响：应增加只读 `DO` 断言或等价脚本，使任何不符合项返回非零；同时覆盖所有业务表、sequence、默认 ACL、`_prisma_migrations`、worker 和对象 owner。

### P1：基建文档仍有 Tair 旧口径

权限方案后续版本已登记 `8deb2da`，但同一基建返修分支的环境变量矩阵和修订状态仍写“当前代码尚未实现前缀”。

影响：实施人员可能错误地把已完成代码当阻断，或反向混用旧变量。应统一为：app 配置 `REDIS_URL` 与 `REDIS_KEY_PREFIX=rcd:v2:preprod:`；HTTP-only worker 两项均不配置；真实连接仍待授权验收。

## 4. 当前真正尚未完成的工作

### 应用与发布包

- V2 liveness/readiness 实现和鉴权反例；
- Dockerfile、`.dockerignore`、Next.js standalone 或等价最小镜像；
- 同镜像 app/worker/migration 三角色启动定义；
- Nginx 受限入口、HTTPS/内部 origin 和日志配置；
- 新候选 SHA、完整测试/构建/安全审计、容器冒烟；
- 确认 9 个正向 migration 原始字节和清单指纹未变。

### RDS/Tair 实施前置

- 独立只读核验用户已报告创建的 `rcd_v2_preprod`、RDS app/worker、Tair app/worker；不得重复创建；
- 复核 RDS/Tair 续费、实例运行、最新备份、恢复点、地域、VPC/交换机和网络白名单；
- 返修并冻结权限 SQL，生成文本 checksum；
- 在真实新库执行权限基线、9 个 migration、迁移后授权和失败关闭验收；
- 撤销/隔离 migration owner 长期连接，确认 app/worker 权限；
- 仅向 app 注入预生产 `REDIS_URL` 和固定前缀，执行真实 Tair 前缀/TTL/锁/降级验收；
- worker 不注入 RDS/Tair/高德连接。

### 阿里云运行基础设施

- ECS、ACR、SLS 的实时存在性、产品规格、费用和责任人确认；旧盘点按缺失处理，不能直接写成已开通；
- ECS 与 RDS/Tair 同地域/VPC连通，安全组和数据库白名单不开放全网；
- 秘密托管产品、所有者、轮换周期、应急吊销人；
- app/worker 发布、SLS 日志、健康检查、连续每分钟 worker 和十分钟基线证据；
- 关键业务冒烟、Redis 故障降级、镜像回退和失败现场；
- Gate 3 最终终审。

## 5. 去重后的串行实施方案

### A. 本地返修闸门（不碰云）

1. 在基建返修分支修正 `2653ded`：回收脚本增加 owner 检查，改逐表权限，验收改失败关闭，统一 Tair 文档；
2. 为权限 SQL 生成 checksum，并在一次性本地库重新执行 9 个 migration、正向授权、负向权限和回收测试；
3. 在当前 Gate 3 应用候选分支补 V2 health/readiness、Docker/Nginx 和三角色部署定义；
4. 形成新应用 SHA，重跑完整工程检查、容器冒烟和正向 migration 指纹不变性。

### B. 阿里云只读闸门（不写资源）

1. 只读核验已报告创建的新库/账号，存在则直接复用，不重复创建；
2. 核验续费、备份、恢复点、VPC、白名单、ECS/ACR/SLS 和费用；
3. 冻结实际资源脱敏标识、维护窗口、实施人、审计人和回退决定人。

### C. 动作级预生产变更闸门

按 RDS 权限基线 → migration → 对象授权 → app Tair 秘密注入 → 镜像/运行基础设施 → app → worker 的顺序逐项授权。每项执行前确认目标、账号、影响、回退和费用；任一失败即停止，不合并成“全部允许”。

### D. 验收与 Gate 3 终审

收集 migration、权限、Tair、镜像、健康检查、worker、日志、回退和未完成项证据。只有阿里云预生产闭环与终审均通过，Gate 3 才能 `PASS`。

## 6. 推荐的下一动作

先执行 A1：只返修基建权限方案和冲突文档，不改应用、不连接阿里云。A1 通过后，再执行应用部署可用性返修，避免两条线同时改变验收基线。

大白话：已经做好的 worker 和 Redis 不再重做；先修好数据库权限施工单，再补应用的 Docker 与健康检查，最后才去阿里云按步骤施工。

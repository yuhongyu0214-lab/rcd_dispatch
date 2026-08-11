# Gate -1～Gate 3-3 综合审查返修记录（2026-07-26）

> 历史审查输入：Gate 3-2 返修前基线（仅供追溯，不再作为当前验收对象）
>
> 当前唯一应用候选：`codex/v2-gate3-app-candidate @ 3dea9260865f7e6ed42938d83e370e3823d31a2d`
>
> 当前结论：代码级 P0/P1、G3-3 编排/锁/事务/并发、Tair 前缀、依赖安全和 rollback 顺序返修已收口到上述唯一候选；Next.js 15.5.21、React 19.2.8、SheetJS 官方 CDN 0.20.3 已通过完整审计与回归，外部 HTTP 契约、枚举、Schema 和 9 个正向 migration 内容未变。权威文档、最终 migration checksum 和一次性空 PostgreSQL 演练已完成。Railway 仅保留历史 Demo 证据，正式生产旧裁决已被 Gate 3-R 阿里云主线替代。当前仍需阿里云预生产实施验收，Gate 3 不提前宣布 `PASS`，第二轮并行继续冻结。

## 1. 修复结果

| 审查问题 | 级别 | 修复 |
|---|---|---|
| 司机 JWT 在非生产环境跳过签名、存在默认密钥；旧司机入口二次采信 query/body driverId；签名 token 可不带 `exp` | P0/P1 | 所有环境强制校验 HS256 签名与有限整数 `exp`，到期边界严格拒绝；`DRIVER_JWT_SECRET` 缺失时失败关闭；tasks/accept/complete/nav/location 只使用 `extractDriverId()`，query 调试回退只在非生产且显式 `ALLOW_INSECURE_DRIVER_ID=true` 时由该函数统一控制 |
| 内部事件复用 `OrderSourceEvent` 并扩展外部 `sourceSystem=INTERNAL` | P0 | 新增独立 `DispatchEventOutbox`；迁移历史内部事件后重建外部来源枚举；内部事件和来源事实的所有权彻底分离 |
| 业务事实提交后再写事件，进程中断会漏排；位置变化未使旧快照失效 | P0 | 订单创建/修改/取消、达到 200m 或 ETA 缓存到期的有效调度位置变化、班次起止均在原业务事务内入队；有效位置在同一事务递增 `planVersion`，满足 200m/120s 时同时保存历史样本，outbox 写失败使业务事务回滚 |
| `handleInternalEvent` 仍为 Gate 3 stub | P0 | 接入真实调度应用层：构建影响范围快照、真实 ETA、纯计算核心、Redis 短锁、数据库提交器、过期快照重试 |
| 来源取消只改订单，未原子释放 Assignment/司机计划/预警 | P0 | 行锁内完成 Assignment 取消、订单解绑与终态、预警解决、操作日志、司机 `planVersion` 单次递增和 outbox 入队 |
| 下班会误把调度员设置的 `UNAVAILABLE` 改回可用，锁键/版本不统一 | P1 | 上班不修改 availability；统一 `dispatch:lock:{driverId}`；数据库行锁兜底；执行中禁止下班；释放未出发任务后聚合版本只递增一次 |
| 订单修改审计只有版本号，没有字段前后值；班次无审计 | P1 | `ORDER_MODIFY` 保存全部可变字段 before/after；班次起止写 `SHIFT_START/SHIFT_END`，同事务保存操作者、时间和 traceId |
| ETA 混合 Top-8 会淘汰司机当前位置/既有 cursor，且修后仍会裁掉本轮新规划 A 槽产生的 delivery cursor | P0/P1 | 正确性优先：司机当前位置、既有时间轴 cursor 和计划池全部订单 deliveryLocation 均为必算起点，恢复全部 delivery→pickup 必要组合；新增贯穿 `buildEtaMatrix()` 与 `runDispatchV2()` 的 A→B 回归，断言第二单使用第一单送达点作为 deadhead 起点 |
| outbox 即时消费失败后没有补偿入口；缺少十分钟基线校验生产者 | P0/P1 | 增加领取租约、失败退避、错误留存、批量 drain；受保护 worker 每次先按 UTC 十分钟稳定桶幂等生成 `BASELINE_RECALCULATION`，再消费待处理事件 |
| 每条约 30 秒位置高水位样本都会立即完整重排 | P1 | 最新位置仍单调更新到 Driver/Redis；历史样本按 200m/120s 落库，调度按首次样本、移动超过 200m 或默认 60s ETA 缓存到期触发；触发时事务内递增版本和写 outbox，提交并更新缓存后才运行调度 |
| API/CORS/时间/错误 reason/环境变量漂移 | P1 | 204 OPTIONS 补 `X-Trace-Id`；带时区 ISO 8601 校验对齐契约；补 `STORE_NOT_FOUND`；统一 `CORS_ORIGINS`；`.env.example` 补司机 JWT、Redis、worker、日志级别和 ingest 来源绑定 |
| 日志实现不是锁定的 Pino | P1 | 引入 `pino@9.6.0`，保持现有 message-first 调用接口并统一输出结构化 JSON |
| Gate 状态、1B 状态和 V2 实施差距文档过期 | P1 | 更新总体 Gate 状态、文档版本总入口、数据架构/API/词汇/代码规则、1B 状态和 V2 运维 runbook |
| `lazyConnect=true` 与 `enableOfflineQueue=false` 下首个 Redis 命令未显式连接，位置新鲜度和 V1 候选过滤又以同步 `ready` 状态提前跳过首读；高德明确配额错误被误判为网络故障重试 | P1 | 所有 Redis 读写/锁操作先共用并发安全的显式连接 Promise；位置与在线读取由动作自身等待就绪并返回整体可用状态，不再做同步前置判断；连接失败保守降级。仅 HTTP status 与 infocode 都缺失时按网络故障重试，高德 `10003` 配额错误立即失败且不产生 ETA |

## 2. 数据迁移与回滚

迁移目录：
`feature-admin-workflow/prisma/migrations/20260726143000_dispatch_event_outbox/`

正向迁移采用一个事务：

1. 创建 outbox、唯一键、领取/待处理索引和事件类型约束（含 `BASELINE_RECALCULATION`）；
2. 拒绝未知的历史内部事件类型；
3. 将每条历史 `INTERNAL` 事件按稳定 eventId 迁入 outbox，保持待处理；
4. 核对源/目标数量一致后才删除旧行；
5. 重建 `OrderSourceSystem`，移除 `INTERNAL`。

rollback 采用数据安全阻断：outbox 中存在任何业务事件时拒绝删除表；
空表时通过重建枚举恢复旧结构，不依赖同事务内直接使用新增 enum 值。
禁止为了通过 rollback 保护而直接清空 outbox。

## 3. 受控边界说明

事务 outbox 必须与业务事实使用同一个 Prisma transaction client，因此本次返修
不能只修改 Gate 3 application 目录。经本次综合审查授权，返修分支精准修改了
1A 订单来源、1B 位置/班次、Schema/迁移、公共错误 reason 和权威文档。

这些跨域改动只服务于已记录缺口，没有提前实现 2A Web、2B 司机执行接口或
2C 观测页面；事件类型与薄触发器已保留给后续执行/模块写入点使用。

## 4. G3-3 开发闭环

| 范围 | 实现与验收 |
|---|---|
| 调度作用域 | 司机位置、班次和 Assignment 事件先解析受影响门店，再加载门店内全部活动司机；下班释放订单可立即与其他候选司机比较，不再把快照收窄为触发司机本人 |
| 至少一次消费幂等 | 提交器在订单/司机行锁和 `planVersion` 校验后对账当前 Assignment；司机、订单、槽位、计划时间和 ETA 完全一致时保留原 Assignment，不写回收/新建日志、不递增版本；真实计划字段变化仍正常替换 |
| Redis/数据库锁 | 独立编排测试覆盖司机/订单短锁成功、锁忙阻断、Redis 不可用时降级到数据库行锁与版本校验；Railway 容器内连接真实 Redis 的集成用例进一步验证锁忙、token 所有权释放与释放后重新获取 |
| 过期快照 | 提交发现版本变化后释放本轮锁、重读快照、重算 ETA，最多三次；独立测试验证不会复用旧计算 |
| outbox 多 worker | 完成确认继续校验 `lockToken`；租约已被其他 worker 接管时返回 `skipped`，不误计 `processed` |
| 边界 | 继续使用 `feature/v2-gate3-review-remediation`；未新建 G3-3 分支，未进入 2A/2B/2C |

## 5. 本地验证

| 命令 | 结果 |
|---|---|
| `pnpm test` | 38 个常规测试文件、433 个测试通过；3 个外部集成测试文件、7 个测试默认跳过，需显式环境开关执行 |
| `pnpm lint` | 通过，0 warning / 0 error |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 通过 |
| `pnpm exec prisma generate --schema prisma/schema.prisma` | 通过 |
| `pnpm exec prisma validate --schema prisma/schema.prisma` | 使用隔离本地 PostgreSQL URL 通过 |
| `pnpm build` | 通过，编译、类型检查和 29 个静态页面生成成功 |
| `git diff --check` | 通过 |

构建环境没有配置 `DATABASE_URL` 和 `AMAP_SERVER_KEY`，因此页面数据收集阶段
出现预期的依赖降级日志；构建命令退出码为 0，不代表真实依赖验收已完成。

## 6. 集成证据（更新至 2026-07-29）

| 范围 | 环境与结果 |
|---|---|
| 正向迁移 | 隔离 PostgreSQL 18：迁移前 public 表 13 张、历史 INTERNAL 事件 2 条、外部来源事件 1 条；迁移后表 14 张、outbox 2 条且均为 `migrated:*`、外部事件保留 1 条、重复 eventId 0、CHECK 含 `BASELINE_RECALCULATION`、来源枚举精确为 `HALUO/PLUGIN/API/V1_IMPORT` |
| 空表 rollback | 独立克隆库执行成功；outbox 表不存在，来源枚举恢复 `INTERNAL`，`Order_sourceSystem_no_internal_check` 恢复 |
| 非空 rollback | 独立克隆库写入 1 条 outbox 后执行返回码 3 并抛出预期阻断；表和事件均保留，来源枚举未提前恢复 `INTERNAL` |
| outbox 多 worker | `processor.integration.test.ts` 连接真实 PostgreSQL：并发双领取仅 1 个 `processed`、另 1 个 `skipped`；失败写 `lastError` 与退避时间后可重试成功；120 秒旧租约可被接管，3/3 通过 |
| Redis 不可用 | 生产 `ioredis` 客户端连接本机关闭端口，健康检查为 false，资源锁返回 `unavailable`，调用方保留数据库锁降级路径；1/1 通过 |
| Redis 可用/锁忙 | 项目阿里云 Redis 主机 TCP 连接在当前网络超时；经明确授权，在 Railway app 容器内以 `GATE3_REDIS_INTEGRATION=available` 连接其真实 Redis 执行 `redis.integration.test.ts`：Redis 成功连接后，锁获取、竞争 token 返回忙、错误 token 不得释放、正确 token 释放及再次获取全部通过，1 个可用场景通过、1 个未配置场景按设计跳过。SSH 使用独立临时 `known_hosts` 做一次性 TOFU；测试后公钥 `SHA256:QEx2OdVDF56Bol7Ew7wuaVyWeAjQxD/zXkEROzjnU2c` 已从 Railway 撤销，私钥、公钥和 TOFU 记录所在临时目录已删除，Railway 返回无已注册 SSH key |
| 高德成功/无路径 | 使用现有服务端 Key：上海市内驾车路径返回正距离/正时长；上海到服务区外坐标返回 `AMAP_NO_ROUTE_FOUND`，2/2 通过 |
| 高德超时/配额 | 可控 HTTP 反例验证 Abort 超时在 4 次有界尝试后返回 `AMAP_TIMEOUT`；`10003` 配额错误不重试；空 paths 不产生 ETA，4/4 通过。结合真实成功/无路径证据，已满足 Gate 3“不造假 ETA”要求，无需故意耗尽真实 Key，不列为阻断项 |
| 远端数据库 | 阿里云实例 `pgm-uf607246o2m33889` 的全量备份于 2026-07-27 15:45:22 完成；2026-07-28 仅对集成主库 `rcd_dispatch` 执行唯一待迁移项 `20260726143000_dispatch_event_outbox`，未触碰 `postgres` 或 `rcd_dispatch_shadow`。迁移 SHA-256 为 `74d9a8780bc06a1bf4e95ef42cbabea3f91719d5b861845ada540b573b9d8410`，正向 SQL 与 Prisma 迁移记录在同一事务提交。数据库核对结果：已完成且未回滚迁移 9 条、迁移记录 checksum 命中、`DispatchEventOutbox` 存在、`INTERNAL` 已从 `OrderSourceSystem` 移除、事件 CHECK 含 `BASELINE_RECALCULATION`、迁移时 outbox 行数为 0。2026-07-29 将临时账号拥有的 8 个关系对象原子归还给既有 `rcd_app` 后，删除 `gate3_migrator` 与 `gate3_migrator_s`；RDS `DescribeAccounts` 复核无两账号。DMS 已改为不托管，免登录实例为 0、未登录实例为 1，不再保存临时凭据 |
| 周期任务 | 私有 Railway 项目 `rcd-dispatch-production` 中 app 部署 `4a70b1ac-18eb-4c88-9a7e-a569b1054c16`、worker 部署 `d34179ea-7763-4cad-a578-6cd7e7457775` 均成功。worker 在 `14:03:34/14:04:34/14:05:35Z` 连续成功调用，间隔约 60 秒，依次为 `processed=1/0/0`、`failed=0/0/0`；日志只有 traceId、计数和耗时，Authorization 未进入 URL 或日志。该部署来自未提交返修工作区并使用试用额度，只记为 Demo 运行证据 |

三个外部集成测试文件默认 `skip`，不会使普通 `pnpm test` 访问外部依赖；
显式执行方法见应用 runbook §11.3。

## 7. 重新放行前仍需完成

1. 已完成权威技术基线、HTTP 契约不变性、枚举、设计变量、状态与决策记录审查；所有当前验收引用只指向唯一应用候选完整 SHA。
2. 已仅从该 Git 对象生成 9 个 migration 的顺序清单、逐文件 SHA-256 和全部 17 个 SQL 的聚合指纹。
3. 已在一次性空 PostgreSQL 演练库完成 9 个正向 migration、最终 Schema、8 个现有 rollback、五类安全护栏与失败现场保留验证。
4. 经单独授权后，按 Gate 3-R 阿里云生产主线完成 RDS/Tair 最小权限与网络、可追溯 app/worker 发布、生产登录面、变量、健康检查、连续周期调用、日志脱敏和回滚证据。
5. 完成阿里云预生产闭环后重新执行 Gate 3 终审；Railway 历史 Demo 不作为剩余阻断，也不作为生产 PASS 证据。

完成以上外部阻断后重新执行 Gate 3 审查；只有 `PASS` 才能创建第二轮并行分支。真实高德超时或配额耗尽不属于 Gate 3 阻断项。

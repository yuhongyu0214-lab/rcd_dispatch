# Gate 3-R 故障注入与应用回退验收

> 文档类型：`STATUS / EVIDENCE`
>
> 日期：2026-08-10
>
> 环境：阿里云预生产
>
> 当前候选：`958afca537b412fb972b6e180561a9b37022834d@sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`
>
> 应用回退：`084649f498c7bce3c1418c2a5d9273282b085efc@sha256:4664fc50cbd1a6bf08e24e99447d2f03097e3d21a74fcdaa80d2c2c432b05947`
>
> 权威边界：本文只记录验收事实，不修改产品、API、数据、枚举或部署规则

## 1. 结论

故障注入与应用回退验收通过。worker 停止期间 app 持续可用；系统基线 outbox 形成可重试积压，
恢复单副本 worker 后 14 秒内自动排空。应用按 app → worker → Nginx 顺序回退到冻结镜像用时
30 秒，再按相同顺序恢复当前候选用时 31 秒；两阶段 liveness、受保护 readiness、数据库、
Redis/Tair、高德、HTTPS、运行 revision、镜像 digest、单 worker 和冻结 10 单执行状态均通过。

测试 Agent 不自行宣布 Gate 3 `PASS`。当前结论为 `FINAL_REVIEW_PENDING`，第二轮继续冻结。

## 2. 验收文件与条件

本轮追加并实际执行：

- `.gate3r-e2e/fault-rollback-20260810/gate3-fault-probe.cjs`：只读业务快照、健康检查、
  系统基线调用与隔离 Tair 短锁；
- `.gate3r-e2e/fault-rollback-20260810/run-worker-fault.sh`：worker 停止、积压、接管和恢复；
- `.gate3r-e2e/fault-rollback-20260810/run-application-rollback.sh`：app、worker、Nginx 分阶段
  回退与恢复。

没有使用 Mock 数据库、Mock Redis 或 Mock 高德。唯一故障条件是在预生产隔离前缀中写入一个
120 秒自动过期的调度锁，使正常 10 分钟基线事件返回 `DISPATCH_RESOURCE_BUSY`；脚本正常或异常
退出都会释放该锁，TTL 是最终兜底。

失败判定包括：app HTTPS 非 200、readiness 任一真实依赖不可用、worker 非单副本或不健康、
outbox 不积压/不排空/保留错误、运行 revision 或 digest 不匹配、冻结 10 单不再保持 9 单完成且
订单 7 未分配、回退后不能恢复当前候选，或任何步骤要求 migration、直接数据库写入、基础资料
重跑和失败样本清理。

## 3. worker 故障与积压恢复

通过证据目录：
`/home/rcdops/evidence/gate3r-worker-fault-20260810T103706Z`。

- worker 明确进入 `exited`，app HTTPS 在故障期间保持 `200`；
- 故障事件为正常基线 `baseline-recalculation:2026-08-10T10:40:00.000Z`；
- 积压快照为 `pending=1 / failed=1 / attempts=1 / lastError=DISPATCH_RESOURCE_BUSY`；
- 释放短锁并启动单副本 worker 后，事件 `attempts=2`、`processedAt` 有值、`lastError=null`；
- 最终 `pending=0 / failed=0`，恢复耗时 14 秒，HTTPS 为 `200`；
- 冻结 10 单仍为 10 条，其中 9 条 `COMPLETED`，订单 7 保持 `UNASSIGNED`；
- 证据清单 checksum 全部通过。

订单 7 的初始 `INFEASIBLE` 与开放预警结论以真实 10 单封存证据为准。持续基线会按最新位置重新
计算其当前 feasibility；本次前后均为 `UNKNOWN` 且仍有 1 条开放预警，不属于执行状态回退。

## 4. 应用回退与恢复

通过证据目录：
`/home/rcdops/evidence/gate3r-application-rollback-20260810T104522Z`。

### 4.1 回退阶段

- app/worker 精确运行回退 digest `sha256:4664fc…5947`，OCI 与三容器 revision 均为
  `084649f498c7bce3c1418c2a5d9273282b085efc`；
- Nginx 仍为 `nginx:1.27-alpine`，只重建容器刷新 revision，配置、证书和端口未改变；
- liveness/readiness 均为 `200`，readiness 的 db/redis/amap 均为 `ready`；
- worker 单副本且健康，HTTPS `200`，outbox `pending=0 / failed=0`；
- 冻结 10 单保持 9 单完成、订单 7 未分配；回退耗时 30 秒。

### 4.2 恢复阶段

- app/worker 精确恢复当前 digest `sha256:13e0f3…5bff`，三容器 revision 均恢复为
  `958afca537b412fb972b6e180561a9b37022834d`；
- liveness/readiness、db/redis/amap、单 worker、HTTPS、outbox 和冻结 10 单执行状态再次通过；
- 恢复耗时 31 秒，证据清单 checksum 全部通过。

以上是服务级应用回退时间，不替代 RDS 隔离恢复或整机重建演练，也不单独证明灾难恢复 RPO。

## 5. 失败现场与偏差

- `gate3r-worker-fault-20260810T102915Z`：只读 helper 使用错误字段名，在停 worker 前停止；
- `gate3r-worker-fault-20260810T102954Z`：曾误判入单只由 worker 消费。worker 停止后 app 仍即时
  处理该订单，因此没有形成积压；安全钩子恢复 worker；
- 上述偏差留下 1 个独立测试订单 `G3FAULT-WORKER-20260810T102954Z`，当前为
  `UNASSIGNED / UNKNOWN`，其 outbox 已处理、`lastError=null`。它不属于冻结 10 单，本轮没有清理；
- `gate3r-worker-fault-20260810T103254Z`：旧断言把滚动 feasibility 当成静态事实，在停服务前停止；
- `gate3r-application-rollback-20260810T104333Z`：回退版 app/worker 已健康，但 Nginx 刚重建时
  单次 HTTPS 检查遇到瞬时 `Broken pipe`；安全钩子完整恢复当前版本。修正为轮询后通过。

所有失败目录继续保留。Compose 提示的历史 migration 容器也未使用 `--remove-orphans` 清理。

## 6. 禁止项与最终状态

本轮未执行 migration，未重跑或修改基础资料，未直接写 PostgreSQL，未清理任何订单、预警、
outbox、失败目录或历史容器，未读取/输出私钥或其他秘密值。最终预生产 app、worker、Nginx
均对齐 `958afca…`；app/worker 健康、HTTPS `200`、outbox 无积压或错误。

下一步只做 Gate 3 最终文档/代码/资源一致性审查；终审前不得再次变更预生产服务或启动第二轮。

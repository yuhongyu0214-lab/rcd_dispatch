# Gate 3-R 真实 10 单重验进度

> 文档类型：`STATUS / EVIDENCE`
>
> 日期：2026-08-10
>
> 环境：阿里云上海预生产 `rcd_v2_preprod`
>
> 代码基线：`codex/v2-gate3-app-candidate @ 958afca537b412fb972b6e180561a9b37022834d`
>
> 镜像：`sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`（ACR index digest）
>
> 权威边界：本文只记录运行事实、失败原因和下一步，不修改产品、API、数据、调度或部署规则

## 1. 当前结论

冻结真实 10 单已完成并通过本轮验收：订单 1～6、8～10 共 9 单完成；订单 7 按预期保持
`UNASSIGNED / INFEASIBLE` 并生成 1 条 `OPEN` 预警。A/B/C、真实高德 ETA、并发冲突、旧版本
冲突、到达后改排拒绝和接入幂等均取得证据。Gate 3 仍为 `NOT_PASS`，下一子闸门为已获准的
故障注入与应用回退；第二轮继续冻结。

执行方式仍是两台真机、三个账号串行：手机 1 保持司机 01；手机 2 先登录司机 03 完成
订单 4～6，再切换司机 05 完成订单 8～10。订单 7 继续由司机 01 验证。账号切换不等于增加
真机数量，最终不得宣称五台设备覆盖。

## 2. 发布与运行基线

- 本地 HEAD、Git 远程和 ACR 均为 `958afca537b412fb972b6e180561a9b37022834d`。
- app 与 HTTP-only 单副本 worker 已按上述 ACR digest 分阶段更新并通过健康核对。
- Nginx 随后仅重建容器以刷新 `RCD_RELEASE_REVISION=958afca…`；镜像、配置、证书和端口均未改变。
- 本轮未执行 migration，未重复写入基础资料，未清理首轮或本轮失败样本。
- 原始冻结数据包保持只读；ZIP SHA-256 仍为
  `cfa37d9059a4861e9d07084b67d13eaaba421843879932c3665e82b9365cef50`。

## 3. 订单 1～3：通过

证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-normal-20260810T064930Z`

- 原包与运行证据 checksum 通过。
- 司机 01 在 ETA 计算时的位置年龄 `33s`、精度 `6.3m`，坐标位于上海。
- 六次高德路线调用均为真实调用且一次成功，没有使用假 ETA、时间或坐标。
- 接入 `3/3` 成功，`skipped=0`、`failed=0`，trace 为
  `26f19e7f-5508-4d3f-90bd-ca1951bbfa03`。
- 三个订单分别形成司机 01 的 A/B/C，序号为 1/2/3，均为 `NORMAL`，初始 slack 为 14，
  开放预警为 0。
- 三单均完成 `depart / arrive / complete`，业务 outbox 最终清空。

结论：`NORMAL_ABC = PASS`。

## 4. 订单 4～6：首次执行停止

证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-20260810T070020Z`

- 失败证据 checksum 通过；司机 02 位置年龄 `17s`、精度 `32m`，位于上海。
- 真实 ETA 调用通过，路线均为一次成功；接入 `3/3` 成功，trace 为
  `0a91d763-d2d6-4965-8522-f9b2fef82430`。
- worker 已处理三个 `ORDER_CREATED` outbox 事件，但三个订单保持 `UNASSIGNED / UNKNOWN`，
  未生成 Assignment 或 Alert，验收脚本按超时停止。
- 根因：司机 02 属于 `G3E2E_SH_HONGQIAO`，订单 4～6 属于 `G3E2E_SH_QIXIN`；七莘门店
  的司机 03、04 当时没有新鲜位置。数据架构要求调度候选按受影响门店加载，因此司机 02
  不应进入这组三单的候选集合。
- 未对订单 4～6执行司机动作；订单 7～10 未投递；没有清理或直接写数据库。

结论：该次是 `EXECUTION_TOPOLOGY_FAIL`，不是调度门店隔离缺陷。订单 4～6 的业务场景尚未
通过，必须保留此证据，并以相同 external ID、递增 sourceVersion 在司机 03 产生新鲜位置后重试。

## 5. 订单 4～6：司机 03 边界样本失败

首次司机 03 证据目录：
`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-driver03-final-20260810T084100Z`

- ETA 阶段位置年龄 `75s`、精度 `8.8m`，六次高德调用均一次成功；接入 `3/3`，trace 为
  `0139084f-b05d-4f21-a32f-13f078601b59`。
- T0 后新位置到达过晚，订单 4、5 为 `-7 / -19`，第 6 单为 `-34 / INFEASIBLE` 且有
  `OPEN` 预警；该尝试未执行司机动作。

收紧重试证据目录：
`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-driver03-retry2-20260810T084630Z`

- 等到 `5s / 5.0m` 的新位置后开始，ETA 阶段位置为 `27s / 4.6m`，T0 缩短为 20 秒；
  六次真实高德路线均一次成功。
- 接入 `3/3`，trace 为 `78846b28-b2d4-45be-adf1-1b14e85e8b91`；9 个相关 outbox 均已处理，
  `lastError=null`。
- 订单 4 为司机 03 的 A、`AT_RISK / -6`；订单 5 为 B、`AT_RISK / -16`；订单 6 为
  `UNASSIGNED / INFEASIBLE / -31` 并产生 `OPEN` 预警。
- 生成阶段订单 4 的直接高德 deadhead 为 `41` 分钟，调度引擎复算为 `42` 分钟。第 6 单原
  目标恰好为 `-30`，前序多出的 1 分钟累计把它推过产品不可行边界。
- 未执行任何 `depart / arrive / complete`；失败快照和 `CHECKSUMS-FAILURE.sha256` 已保存。

结论：系统按 `-30` 阈值分类正确；失败源于真实高德重复调用在边界上的分钟级波动，不是
产品阈值缺陷。用户已批准仅把第 6 单的真实 E2E 目标从 `-30` 调整为 `-25`。产品阈值、
API、Schema、原始 ZIP/manifest 与原包 SHA-256 均不变；精确 `-30` 边界继续由确定性自动化
测试覆盖。

## 6. 修正后的冻结执行拓扑

| 冻结订单 | 场景 | 真机与账号 | 验收重点 |
|---|---|---|---|
| 1～3 | `NORMAL_ABC` | 手机 1 / 司机 01 | 已通过，A/B/C 正常且无开放预警 |
| 4～6 | `AT_RISK_ABC` | 手机 2 / 司机 03 | 目标 slack `-5 / -15 / -25`；七莘门店内形成 A/B/C 和风险证据后完成 |
| 7 | `INFEASIBLE_ALERT` | 手机 1 / 司机 01 | 不可行结果和 `OPEN` 预警 |
| 8～9 | `MANUAL_REASSIGN` | 手机 2 / 司机 05；手机 1 / 司机 01 为改排目标 | 到达前成功一次；并发、旧版本和到达后改排均拒绝 |
| 10 | `INGEST_IDEMPOTENCY` | 手机 2 / 司机 05 | 相同 sourceVersion 重放无重复事实或副作用 |

每组开始前，目标账号必须在真实 iOS H5 上产生上海范围内、采集不超过 120 秒、精度不大于
100 米的位置。订单 4～6 本次重试进一步收紧为 ETA 阶段不超过 30 秒、T0 为当前时间后 20 秒。
自动调度组必须同时满足账号属于订单门店；手工改排组同时刷新司机 05 和 01。

## 7. 第 6 单运行时覆盖边界

- 原始数据包和 manifest 保持只读，不改原文件与 checksum。
- 只在新的独立证据目录把第 6 单承诺时间按真实 projected pickup 减 `25` 分钟生成，并保存
  `originalTargetSlackMinutes=-30`、`runtimeTargetSlackMinutes=-25`、产品阈值和原包 checksum。
- 订单 ID、地址、车牌、业务类型、订单 4/5 目标和所有既有失败证据保持不变。
- 通过条件：4～6 均形成司机 03 的 A/B/C，实际 slack 均满足 `-30 <= slack < 10`，三单均
  为 `AT_RISK` 且无 `OPEN` 预警；通过前不得执行司机完成动作。

## 8. 历史预检与停止条件

文档冻结后已直接发起两次预检，证据目录分别为
`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-driver03-target25-20260810T090246Z` 和
`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-driver03-target25-20260810T090324Z`。第一次因临时
容器普通用户不能读取只读 manifest 而在业务调用前停止；第二次改用临时容器 root 只读访问
后，因司机 03 位置超过 30 秒而在高德调用和投单前停止。随后 50 秒只读轮询仍未收到新样本；
最后位置为上海坐标、精度约 `9.1m`、司机仍在班，但采集时间停留在
`2026-08-10T08:53:40.739Z`。两个目录均只含 helper 与 `eta-output.log`，没有渲染批次、接入
结果或新订单写入；失败目录继续保留。

上述停止条件只解释历史预检为何没有投单；后续收到新鲜位置后已按冻结边界完成重试。

若司机 03 在 ETA 阶段的位置超过 30 秒、精度大于 100 米、坐标不在上海、账号/门店不匹配、原始包
checksum 变化，或任一 A/B/C、slack、预警、并发、改排、幂等结果不符合冻结预期，立即停止并判定
对应场景未通过。

## 9. 最终 10 单验收结果

### 9.1 订单 4～6：`AT_RISK_ABC`

- 证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-at-risk-driver03-target25-20260810T090917Z`。
- 司机 03 在 ETA 阶段位置年龄 `22s`、精度 `9.5m`，位于上海；6 次真实高德调用均一次成功。
- 接入 trace 为 `90906d01-ed26-4757-bce1-62b1432611d4`；A/B/C 初始 slack 分别为
  `-5 / -15 / -26`，三单均为 `AT_RISK` 且无开放预警，最终全部完成。
- 相关 outbox 全部处理成功；21 个证据文件 checksum 通过。

### 9.2 订单 7：`INFEASIBLE_ALERT`

- 证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-infeasible-driver01-20260810T092022Z`。
- 司机 01 位置年龄 `1s`、精度 `5.5m`，2 次真实高德调用均一次成功；接入 trace 为
  `e93e502b-0004-4264-bb18-52f7a374c211`。
- 初始结果为 `UNASSIGNED / INFEASIBLE / -33`，并生成 1 条 `OPEN / INFEASIBLE` 预警；
  后续重算使当前 slack 漂移为 `-73`，不改变初始判定证据。
- 单条 outbox 已处理且 `lastError=null`。

### 9.3 订单 8～9：手动改排与并发

- 证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-manual-driver05-driver01-20260810T094000Z`。
- 司机 01/05 均有新鲜上海位置，4 次真实高德调用均一次成功；接入 trace 为
  `b9120326-c0e5-47de-9026-522edf8d0403`。
- 初始分配司机 05、人工目标司机 01 均符合冻结映射；到达前并发改排只有 1 次成功。
- 旧版本请求返回 `409 / PLAN_VERSION_CONFLICT`；并发败方返回
  `409 / DUPLICATE_OPERATION`；到达后改排返回 `400 / ILLEGAL_TRANSITION`。
- 两单最终完成，相关 outbox 全部处理成功；19 个证据文件 checksum 通过。

### 9.4 订单 10：接入幂等与全量快照

- 证据目录：`/home/rcdops/evidence/g3e2e-r2-retest-idempotency-driver05-20260810T100619Z`。
- 两份接入批次字节与 SHA-256 完全相同；首次 `accepted=1`，重放
  `accepted=0 / skipped=1`。
- 数据事实只有 1 条成功来源事件、1 个订单、1 个 Assignment 和 1 个 `ORDER_CREATED` outbox；
  重放未产生第二条来源事件或其他副作用。
- 订单 10 最终完成；最终快照为 9 单完成、订单 7 不可行并保留 1 条开放预警，全部 outbox
  已处理且无错误；24 个证据文件 checksum 通过。

### 9.5 失败判定与边界

通用 helper 曾因把单个订单 10 错当成三单序列、错误预期两条来源事件和 `jq` 变量作用域而
报错；修正断言前没有执行司机动作，原始输出均保留。复核后的数据库与 API 证据满足冻结标准，
因此这些属于验收脚本错误，不属于业务失败。本轮未执行 migration、重复基础资料、失败样本清理
或直接数据库写入，也未改变产品阈值、原始 ZIP/manifest、API、Schema 或枚举。

下一步仅执行用户已授权的预生产故障注入与应用回退验收：先验证 worker 故障、积压与自动恢复，
再按 app → worker → Nginx 的既有顺序退回冻结镜像并恢复当前候选。任何健康检查、运行身份、
outbox 排空或既有 10 单事实不符合预期时立即停止并优先恢复当前候选。

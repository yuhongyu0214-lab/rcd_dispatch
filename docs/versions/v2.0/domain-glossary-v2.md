# 人车单领域词汇 V2

> 词汇版本：`RCD-GLOSSARY-V2.0-20260717`
> 状态：Gate 0 文档级冻结候选
> 规则：本文件是 V2 术语的唯一权威定义；其他文档与本表冲突时，先修订对齐再冻结，不允许并存两种定义

## 1. 业务核心

| 术语 | 英文/枚举 | 定义 |
|---|---|---|
| 工单 | Assignment | 一名司机对一个订单的完整执行单元：到达取车点 → 执行所选模块 → 驾驶 → 到达送达点 → 完成 |
| 槽位 | `NONE / A / B / C` | 司机计划队列位置。A 当前、B 下一、C 下下；`NONE` 表示不占任何槽位。由有效 Assignment 的 `sequenceNo` 派生，不单独存储枚举 |
| 未分配池 | Unassigned Pool | `executionStatus = UNASSIGNED` 的订单集合，等待进入某司机 B/C |
| 承诺取车时间 | `promisedPickupAt` | 外部订单承诺的取车时间，调度的硬约束 |
| 预计到达取车点时间 | `projectedPickupAt` | 按当前计划推算司机到达取车点的时间 |
| 安全余量 | `slackMinutes` | `promisedPickupAt - projectedPickupAt`（分钟）；可行性判定的唯一输入 |
| 衔接 ETA | `deadheadEtaMinutes` | 前序位置（前工单结束位置或手机实时位置）到本工单取车点的驾车 ETA；调度最小化目标 |
| 工单 ETA | `serviceEtaMinutes` | 取车点到送达点的驾车 ETA |
| 计划占用时间 | — | 固定模块总时长 + 工单 ETA |
| 实际占用时间 | — | `arrivedAt` 到 `completedAt` 的间隔 |

## 2. 状态维度（四个正交维度 + 预警状态）

| 维度 | 枚举 | 权威出处 |
|---|---|---|
| 执行状态 | `UNASSIGNED / PLANNED / EN_ROUTE / IN_SERVICE / COMPLETED / CANCELLED` | PRD §10、10.1 矩阵 |
| 可行性 | `UNKNOWN / NORMAL / AT_RISK / INFEASIBLE` | PRD §5.1（slack 模型） |
| 锁定 | `NONE / AUTO_FROZEN / MANUAL_LOCKED` | PRD §7 |
| 槽位 | `NONE / A / B / C` | PRD §10 |
| 预警状态 | `OPEN / RESOLVED`（属于 `DispatchAlert`，不是订单维度） | PRD §8 |

- `AUTO_FROZEN`：司机点击出发后由系统设置；算法不得移动；调度员在到达前仍可改派。
- `MANUAL_LOCKED`：调度员手动分配后设置；算法不得覆盖，直到解除或司机出发。

## 3. 服务模块（枚举与固定时长冻结）

| 枚举 | 中文 | 固定时长 |
|---|---|---:|
| `CHARGING` | 充电 | 30 分钟 |
| `REFUELING` | 加油 | 5 分钟 |
| `WASHING` | 洗车 | 10 分钟 |
| `HANDOVER_FORMALITIES` | 交车手续 | 10 分钟 |
| `RETURN_FORMALITIES` | 还车手续 | 5 分钟 |

多选、无顺序约束；只累计固定时长，不记录模块级实际耗时。

## 4. 订单接入

| 术语 | 定义 |
|---|---|
| `CanonicalOrder` | 内部唯一标准订单格式；外部字段进入引擎前的必经映射目标 |
| `OrderSourceAdapter` | 来源翻译器：`validate → normalize → map → CanonicalOrder`；外部字段和外部枚举终止于此层 |
| `OrderSourceEvent` | 一次来源投递的持久记录（来源、外部 ID、版本、结果、原始 JSON 摘要） |
| 幂等键 | `(sourceSystem, externalOrderId, sourceVersion)`；orderNo 不得单独作为幂等键 |
| `businessType` | 锁定沿用 V1 值：`STORE_PICKUP / STORE_RETURN / DOOR_DELIVERY / DOOR_PICKUP` |
| `sourceStatusRaw` | 外部原始状态字符串；只存证，不直接写入内部执行状态 |
| `receivedAt` | 服务端接收时间；服务端生成，UTC 存储，不接受外部传入 |

## 5. 位置与班次

| 术语 | 定义 |
|---|---|
| 当班 / 班次 | `DriverShift`；司机上班到下班的区间。是否参与调度以班次 + 位置有效性判定，不只靠位置 |
| 位置新鲜度 | `FRESH`（capturedAt ≤ 120 秒）/ `STALE`（> 120 秒，排除调度并明确标注）/ `NONE`（无样本） |
| 无效样本 | 精度 > 100 米，或客户端时间超前服务端 > 30 秒；拒收不入库 |
| 位置采样 | 落库条件：距上次满 120 秒、移动超 200 米、或出发/到达/完成/上下班事件，任一满足即保存；默认保留 90 天 |

数值口径的唯一权威出处：数据架构 V2 §7.1 / §7.2。

## 6. 调度一致性

| 术语 | 定义 |
|---|---|
| `planVersion` | 司机计划的乐观锁版本号；每次重排递增；写操作携带 `expectedPlanVersion`，不匹配返回 409 |
| 调度短锁 | Redis `dispatch:lock:{driverId}` / `order:lock:{orderId}`，5–15 秒，防并发重排 |
| 局部重排 | 只重排受事件影响的司机 A/B/C，不做全天全局最优 |
| 基线校验 | 每 10 分钟对全部计划做一次校验性重算 |

## 7. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-17 | Gate 0 首次冻结 |

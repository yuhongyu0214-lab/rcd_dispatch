# V1 → V2 兼容映射矩阵

> 矩阵版本：`RCD-COMPAT-V2.0-20260717`
> 状态：Gate 0 已冻结
> 作用：唯一权威的 V1 状态、司机状态、字段与默认迁移策略映射；数据迁移（Gate 1 及迁移验证阶段）以本文件为准
> 原则：V1 枚举和接口在兼容窗口内保留；删除前必须完成迁移验收并获得用户批准

## 1. 订单执行状态映射

V1 `OrderStatus`（8 值）→ V2 `executionStatus`（6 值）+ 正交维度：

| V1 | V2 executionStatus | 附加维度 | 说明 |
|---|---|---|---|
| `PENDING` | `UNASSIGNED` | 槽位 `NONE`、锁定 `NONE` | 直接映射 |
| `RECOMMENDING` | `UNASSIGNED` | 同上 | V2 无“推荐中”暂态；Top N 推荐流程废止 |
| `ASSIGNED` | `PLANNED` | 锁定按 1.1 规则回填 | 已派未执行 |
| `ACCEPTED` | `PLANNED` | 同上 | V2 无接单确认环节，接单语义合并进 `PLANNED` |
| `IN_PROGRESS` | `IN_SERVICE` | 锁定 `AUTO_FROZEN` | V1 无出发/到达之分；迁移时统一按“已到达”处理，`arrivedAt` 按 §1.3 回填链取值 |
| `COMPLETED` | `COMPLETED` | — | 直接映射 |
| `RECYCLED` | `UNASSIGNED` | 槽位 `NONE`、锁定 `NONE` | V1 回收＝释放回池 |
| `CANCELLED` | `CANCELLED` | — | 直接映射 |

### 1.1 锁定回填规则

| V1 派单方式（`AssignmentType`） | V2 lockType |
|---|---|
| `MANUAL_ASSIGN` | `MANUAL_LOCKED` |
| `RECOMMEND_ASSIGN` | `NONE` |
| `REASSIGN` | `MANUAL_LOCKED`（V1 改派均为调度员人工操作，一律按手动锁定回填） |

### 1.2 可行性回填

- 存量订单迁移时可行性一律初始化为 `UNKNOWN`，由 V2 引擎首次重算后写入真实值。
- 不为历史订单伪造 slack 值。

### 1.3 `IN_PROGRESS → IN_SERVICE` 的 `arrivedAt` 回填链（冻结）

现有 V1 `Assignment` 没有开始时间字段（仅 `assignedAt / acceptedAt / withdrawnAt / recycledAt / completedAt`），代码中也没有稳定写入 START 时间的独立字段。`arrivedAt` 按以下优先级取第一个可用值：

```text
1. 该订单当前 Assignment 关联的 OperationLog 中
   最后一条 START 动作的记录时间（createdAt）
2. Assignment.acceptedAt
3. Order.updatedAt
```

- 使用第 2 或第 3 优先级时，必须在迁移生成的 `OrderSourceEvent`（payload 摘要）或迁移日志中记录 `migrationFallback: arrivedAt=<acceptedAt|orderUpdatedAt>` 标识。
- 不为历史工单伪造更精确的到达时间；三级均不可用属于数据异常，该订单转人工核对清单，不自动迁移为 `IN_SERVICE`。

## 2. 司机状态映射

V1 `DriverStatus`（6 值）→ V2 班次 + 可用性 + 位置新鲜度 + 执行推导：

| V1 | V2 onShift | V2 availability | 说明 |
|---|---|---|---|
| `OFFLINE` | `false` | `AVAILABLE` | 未当班，可正常排班 |
| `S1`（门店空闲） | `true` | `AVAILABLE` | 空闲；V2 不再区分门店/返程，位置以实时定位为准 |
| `S2`（返程空闲） | `true` | `AVAILABLE` | 同上 |
| `S3`（门店忙碌） | `true` | `AVAILABLE` | 忙碌状态由 V2 从 A 槽位工单执行状态推导，不再单独存储 |
| `S4`（订单忙碌） | `true` | `AVAILABLE` | 同上 |
| `UNAVAILABLE` | `false` | `UNAVAILABLE` | 人为停派：与“未当班”正交区分；迁移时备注保留原值，恢复须调度员显式设置 |

- V2 不保留 S1–S4 作为业务语义；兼容窗口内枚举列可保留存储但不得作为调度输入。
- “忙碌/空闲”在 V2 是派生视图：由该司机 A 槽位 Assignment 的执行状态计算。

## 3. Assignment 映射

| V1 `AssignmentStatus` | V2 对应 | 说明 |
|---|---|---|
| `ACTIVE` | 有效 Assignment（`PLANNED`） | 进入 sequenceNo 排序 |
| `ACCEPTED` | 有效 Assignment（`PLANNED`） | 接单语义合并 |
| `WITHDRAWN` | 历史链记录 | 保留追溯，不参与派生槽位 |
| `RECYCLED` | 历史链记录 | 同上 |
| `COMPLETED` | 历史链记录（终态） | `completedAt` 取 V1 完成时间；不参与 `sequenceNo` 派生槽位 |
| `CANCELLED` | 历史链记录 | 同上 |

新增字段的默认回填：`sequenceNo` 按现存有效 Assignment（仅 `ACTIVE/ACCEPTED` 映射所得）的创建时间排序生成；每名司机 `planVersion` 初始为 1（归属司机计划聚合，见数据架构 §6）；计划时间与 ETA 字段留空，由首次重算填充。

## 4. 字段映射

| V1 字段 | V2 字段 | 迁移策略 |
|---|---|---|
| `Order.scheduledAt` | `promisedPickupAt` | 直接改名/映射 |
| `Order.returnAddress` | `deliveryAddress` | 统一“送达”语义 |
| `Order.channel` | `sourceSystem` | 按 §4.1 映射表（本文件定稿，Gate 1 不再改动） |
| （无） | `externalOrderId` | 存量订单回填为 `orderNo`；回填标记见 §4.2 |
| （无） | `sourceVersion` | 存量回填保留值 `"v1-migration"`（数据架构 §3.3 冻结例外：仅 `V1_IMPORT` 使用，不经在线 ingest，不参与新旧比较） |
| （无） | `receivedAt` | 存量回填 `createdAt` |
| `Order.status` | `executionStatus` + 维度 | 按 §1 映射 |
| `Driver.status` | `DriverShift` + `availability` + 派生 | 按 §2 映射 |
| `Vehicle.*` | 快照展示字段 | 保留展示；从一切调度输入中移除 |

### 4.1 `channel` → `sourceSystem` 映射表（冻结）

| V1 `channel` 值 | V2 `sourceSystem` |
|---|---|
| `HALUO` | `HALUO` |
| `BROWSER_PLUGIN` | `PLUGIN` |
| 其他任意值 / 空 | `V1_IMPORT`（原值完整保留在迁移生成的来源事件 payload 摘要中，不丢失） |

### 4.2 回填标记（冻结）

- 不新增 `backfilled` 布尔字段。回填标记就是 `sourceVersion = "v1-migration"`：凡此值即表示 `externalOrderId`、`receivedAt` 等字段来自迁移回填，非来源系统投递。
- 迁移时为每条存量订单写入一条 `OrderSourceEvent`（`sourceVersion = "v1-migration"`，结果 `MIGRATED`，payload 摘要含 V1 原始 `channel`、`status` 等原值），作为回填追溯依据。

## 5. 调度规则替换（硬边界，不迁移）

| V1 规则 | V2 替代 | 迁移动作 |
|---|---|---|
| Top N 推荐 + 人工确认 | 自动滚动分配 + 人工改派 | 推荐接口进入兼容窗口，不再演进 |
| ETA ≥ 120 分钟转 MANUAL | slack < -30 分钟 → `INFEASIBLE` 预警 | 阈值不做数值换算，直接替换判定模型 |
| 司机接单/拒单 | 无拒单权；出发/到达/完成三步执行 | ACCEPT 动作不再产生 |
| 3–5 分钟定位 | 30 秒目标上报 + 120 秒过期口径 | 旧 `driver_locations` 数据按 90 天保留策略处置 |
| 车辆参与匹配 | 车辆仅展示 | 匹配代码移除，数据保留 |

## 6. 操作日志动作映射

| V1 `OperationAction` | V2 处置 |
|---|---|
| `ASSIGN / REASSIGN / WITHDRAW / CANCEL / IMPORT` | 保留并沿用 |
| `ACCEPT` | 冻结（历史保留，不再产生） |
| `START` | 由 `DEPART` 与 `ARRIVE` 两个动作取代（V1 历史 START 视为 ARRIVE） |
| `RECYCLE` | 冻结（历史保留，V2 用 WITHDRAW/释放表达） |
| `COMPLETE` | 保留 |
| （新增） | `AUTO_DISPATCH / DEPART / ARRIVE / MODULE_CHANGE / ORDER_MODIFY / ALERT_RESOLVE / SHIFT_START / SHIFT_END / UNLOCK / AVAILABILITY_CHANGE` |

## 7. 兼容窗口纪律

**兼容窗口内有两个独立时点（冻结）**：

| 时点 | 定义 | V1 写接口 | V1 读接口与页面 |
|---|---|---|---|
| ① V2 状态机切换开关开启 | V2 成为唯一事实状态机 | 一律停用：返回 HTTP 410 + 指引信息，**不做命令转译** | 继续可用，经兼容层单向翻译读 V2 事实 |
| ② 兼容窗口关闭 | 迁移验证（并行验证 3A）通过 + 用户批准 | （已停用） | 整体下线 |

- 切换开关开启 **≠** 兼容窗口关闭；两个时点分别验收。
- 时点 ① 之前，V1 写接口照常工作于 V1 状态机。
- 兼容层只做单向翻译（V1 读 V2 事实），不允许 V1 写路径绕过 V2 状态机；不存在“V1 写请求翻译为 V2 命令”的路径。
- 禁止为“看起来统一”提前删除 V1 文件、枚举或状态。

## 8. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-17 | Gate 0 首次冻结：状态/司机/Assignment/字段/规则/日志动作映射与兼容窗口纪律 |
| V2.0-r1 | 2026-07-17 | Gate 0 二轮返修：`REASSIGN → MANUAL_LOCKED` 定稿；`UNAVAILABLE` 拆为 `onShift=false + availability=UNAVAILABLE`；`COMPLETED` Assignment 归入历史链记录；§4.1 `channel → sourceSystem` 映射表定稿；§4.2 回填标记定为 `sourceVersion="v1-migration"`（不新增字段）；§7 冻结 V1 写接口停用不转译 |
| V2.0-r2 | 2026-07-17 | Gate 0 三轮返修：新增 §1.3 `arrivedAt` 回填链（START 日志 → `acceptedAt` → `Order.updatedAt` + `migrationFallback` 标识，三级不可用转人工核对）；§7 冻结兼容窗口两个独立时点（切换开关 ≠ 窗口关闭，V1 读接口存续至窗口关闭） |
| V2.0-r3 | 2026-07-17 | Gate 0 四轮返修：§4 `"v1-migration"` 标注为冻结保留值例外，引用数据架构 §3.3 |

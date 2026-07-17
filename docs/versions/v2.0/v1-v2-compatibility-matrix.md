# V1 → V2 兼容映射矩阵

> 矩阵版本：`RCD-COMPAT-V2.0-20260717`
> 状态：Gate 0 文档级冻结候选
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
| `IN_PROGRESS` | `IN_SERVICE` | 锁定 `AUTO_FROZEN` | V1 无出发/到达之分；迁移时统一按“已到达”处理，`arrivedAt` 取 V1 开始时间 |
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
| （无） | `sourceVersion` | 存量回填 `"v1-migration"` |
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

- V1 页面和接口在兼容窗口内可运行；窗口关闭以迁移验证（并行验证 3A）通过 + 用户批准为准。
- **V1 写接口处置（冻结）**：V2 状态机切换开关开启前，V1 写接口照常工作于 V1 状态机；开关开启后，V1 写接口（派单、改派、撤回、接单、回收、导入等）一律停用并返回明确错误（HTTP 410 + 指引信息），**不做命令转译**，不存在“V1 写请求翻译为 V2 命令”的路径。
- 兼容层只做单向翻译（V1 读 V2 事实），不允许 V1 写路径绕过 V2 状态机。
- 禁止为“看起来统一”提前删除 V1 文件、枚举或状态。

## 8. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-17 | Gate 0 首次冻结：状态/司机/Assignment/字段/规则/日志动作映射与兼容窗口纪律 |
| V2.0-r1 | 2026-07-17 | Gate 0 二轮返修：`REASSIGN → MANUAL_LOCKED` 定稿；`UNAVAILABLE` 拆为 `onShift=false + availability=UNAVAILABLE`；`COMPLETED` Assignment 归入历史链记录；§4.1 `channel → sourceSystem` 映射表定稿；§4.2 回填标记定为 `sourceVersion="v1-migration"`（不新增字段）；§7 冻结 V1 写接口停用不转译 |

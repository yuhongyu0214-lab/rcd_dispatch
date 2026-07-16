# 人车单 V2 API 契约

> 契约版本：`RCD-API-V2.0-20260717`
> 状态：Gate 0 文档级冻结候选；等待正式冻结验收
> 实施约束：本文件只冻结契约，不含任何代码；TypeScript DTO、错误类型和契约测试在 Gate 2 落地
> 上游依据：[PRD V2](prd-v2.md) · [数据架构 V2](data-architecture-v2.md) · [项目规则 V2](project-rules-v2.md)

## 1. 通用约定

### 1.1 路径与版本

- V2 全部新接口位于 `/api/v2/**`，与 V1 路径（`/api/orders` 等）物理隔离。
- V1 接口在兼容窗口内保持可用，不因 V2 上线而破坏。
- 契约变更只允许向后兼容扩展；删除字段或改变语义必须升级 major 版本（`/api/v3/**`）。

### 1.2 统一响应

```jsonc
// 成功
{ "success": true,  "data": { /* 各接口 DTO */ }, "error": null, "traceId": "..." }
// 失败
{ "success": false, "data": null, "error": { "code": "ILLEGAL_TRANSITION", "message": "到达后禁止改派", "details": { "currentStatus": "IN_SERVICE", "targetStatus": "PLANNED" } }, "traceId": "..." }
```

- V2 的 `error` 是结构化对象 `{ code, message, details? }`；V1 的字符串 error 不变，由 Gate 2 提供 V2 版 `ok()/fail()`。
- 每个响应都带 `X-Trace-Id` 响应头，与响应体 `traceId` 一致。
- 请求可通过 `X-Trace-Id` 头传入 traceId；缺省时服务端生成 UUID。

### 1.3 时间格式

- 所有请求与响应时间字段使用带时区 ISO 8601（如 `2026-07-17T09:30:00+08:00` 或 `...Z`）。
- 数据库统一存 UTC；前端按 `Asia/Shanghai` 展示。
- 不带时区的时间字符串一律拒绝（400 `VALIDATION_FAILED`）。

### 1.4 分页

- 查询参数：`page`（1 起）、`pageSize`（默认 20，最大 100）。
- 响应结构：`data: { items: [...], total, page, pageSize }`。
- 超出范围的 `pageSize` 按 100 截断；`page < 1` 返回 400。

### 1.5 错误码（冻结）

| HTTP | code | 语义 | details 必含 |
|---:|---|---|---|
| 400 | `VALIDATION_FAILED` | 参数或字段校验失败 | `fields`（逐字段错误） |
| 400 | `ILLEGAL_TRANSITION` | 非法状态流转（见 PRD 10.1 矩阵） | `currentStatus`、`targetStatus` |
| 401 | `UNAUTHORIZED` | 未登录或 Ingest Key 无效 | — |
| 403 | `FORBIDDEN` | 角色无权限或越权访问他人资源 | — |
| 404 | `NOT_FOUND` | 资源不存在 | — |
| 409 | `PLAN_VERSION_CONFLICT` | `planVersion` 过期 | `currentPlanVersion` |
| 409 | `DUPLICATE_OPERATION` | 并发重复操作（短锁冲突） | — |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超 1 MiB 或批次超 200 条 | `limit`、`actual` |
| 422 | `LOCATION_INVALID` | 位置样本被拒（精度/时钟/过期） | `reason` |
| 500 | `INTERNAL_ERROR` | 未分类服务端错误 | — |
| 503 | `DEPENDENCY_UNAVAILABLE` | 高德 / Redis / 外部订单源不可用 | `dependency` |

- ETA 不可用不是 503：调度接口正常返回，DTO 内 `etaAvailable: false` 并附 `etaUnavailableReason`；禁止假 ETA。

### 1.6 幂等（冻结）

| 场景 | 幂等键 / 策略 |
|---|---|
| 订单接入 | `(sourceSystem, externalOrderId, sourceVersion)`；同版本重复到达返回已有处理结果（`replayed: true`），新版本更新快照并生成来源事件 |
| 司机执行事件（出发/到达/完成） | 状态机幂等：重复提交已生效的同一流转，返回 200 且 `data.replayed = true`；提交矩阵外流转返回 400 `ILLEGAL_TRANSITION` |
| 调度写操作（分配/改派/撤回/解锁） | 请求必须携带 `expectedPlanVersion`；不匹配返回 409 `PLAN_VERSION_CONFLICT` 和 `currentPlanVersion`，客户端刷新后重试 |
| 位置上报 | 按 `(driverId, capturedAt)` 去重，重复样本静默忽略并计入 `skipped` |

### 1.7 角色（冻结）

| 角色 | 认证方式 | 说明 |
|---|---|---|
| `dispatcher` | 会话登录（沿用现有 auth，角色 admin） | 调度员 Web |
| `driver` | 会话登录（绑定 driverId） | 司机 H5；只能操作自己的资源 |
| `ingest` | `X-Ingest-Key` 或 `Authorization: Bearer`，Origin 白名单 | 订单来源（插件/外部 API） |
| `system` | 服务端内部调用，不暴露公网 | 调度引擎、定时校验 |

## 2. 接口清单

### 2.1 调度员（dispatcher）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v2/map/snapshot` | 全局快照：上班司机位置 + 全部可见订单点位 + OPEN 预警计数 |
| GET | `/api/v2/orders` | 订单池分页；过滤：`executionStatus`、`feasibility`、`slot`、`storeCode`、`keyword` |
| GET | `/api/v2/orders/{orderId}` | 订单详情（含当前 Assignment、可行性、预警、修改历史摘要） |
| PATCH | `/api/v2/orders/{orderId}` | 修改 `promisedPickupAt` / `pickupAddress` / `deliveryAddress`；`reason` 必填；立即重算 |
| GET | `/api/v2/drivers` | 司机列表；含班次状态、位置新鲜度、A/B/C 摘要 |
| GET | `/api/v2/drivers/{driverId}/plan` | 该司机 A/B/C 时间轴（含 `planVersion`、衔接 ETA、模块时长、迟到风险） |
| POST | `/api/v2/assignments` | 手动分配 `{ orderId, driverId, reason, expectedPlanVersion }` → `MANUAL_LOCKED` |
| POST | `/api/v2/assignments/{assignmentId}/reassign` | 改派 `{ toDriverId, reason, expectedPlanVersion }`；`IN_SERVICE` 服务端拒绝 |
| POST | `/api/v2/assignments/{assignmentId}/withdraw` | 撤回 → `UNASSIGNED`，`{ reason, expectedPlanVersion }` |
| POST | `/api/v2/assignments/{assignmentId}/unlock` | 解除 `MANUAL_LOCKED`，`{ reason, expectedPlanVersion }` |
| GET | `/api/v2/alerts` | 预警分页；过滤 `status=OPEN/RESOLVED`；预警解决由系统在重算后自动执行，无手工 resolve 接口 |
| GET | `/api/v2/logs` | 操作日志分页；过滤 `orderId` / `driverId` / `traceId` / `action` |

### 2.2 司机（driver）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v2/driver/shift/start` | 上班；开始参与调度 |
| POST | `/api/v2/driver/shift/end` | 下班；执行中（`EN_ROUTE`/`IN_SERVICE` 存在）返回 400 `ILLEGAL_TRANSITION`；未出发任务全部释放 |
| GET | `/api/v2/driver/map` | 所有上班司机位置（全局位置视图，不含他人订单详情） |
| GET | `/api/v2/driver/tasks` | 本人 A/B/C 详情 |
| GET | `/api/v2/driver/orders/unassigned` | 未分配订单列表（只读） |
| PUT | `/api/v2/driver/tasks/{assignmentId}/modules` | 设置服务模块组合（多选，无顺序）；执行中允许修改；立即重算并写日志 |
| POST | `/api/v2/driver/tasks/{assignmentId}/depart` | 出发：`PLANNED → EN_ROUTE`，锁定 `AUTO_FROZEN` |
| POST | `/api/v2/driver/tasks/{assignmentId}/arrive` | 到达：`EN_ROUTE → IN_SERVICE`，实际计时开始 |
| POST | `/api/v2/driver/tasks/{assignmentId}/complete` | 完成：`IN_SERVICE → COMPLETED`，触发重排 |
| POST | `/api/v2/driver/location` | 批量位置上报 `{ samples: [{ lat, lng, accuracyMeters, capturedAt }] }`；逐条校验（§1.6 / 数据架构 7.1） |

- 司机访问非本人 `assignmentId` 返回 403 `FORBIDDEN`。
- 司机无拒单和改派接口；此类操作不存在于 driver 路径下。

### 2.3 订单接入（ingest）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v2/ingest/orders` | CanonicalOrder 原始记录批量接入；限制：单批 ≤ 200 条、体积 ≤ 1 MiB（流式校验）；逐条返回 `success / skipped / failed` 及 reason、traceId |
| OPTIONS | `/api/v2/ingest/orders` | CORS 预检；白名单外 Origin 返回 403 |

- 外部原始状态仅写入 `sourceStatusRaw` 与来源事件，不得直接映射为内部执行状态之外的写入。
- 重复（库内已存在同幂等键、批内重复）计入 `skipped`，不计入 `failed`。

### 2.4 系统（system）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v2/health` | 存活与依赖状态（db / redis / amap 可达性），无需登录 |

## 3. 核心 DTO（字段级冻结）

### 3.1 OrderV2

```text
id, orderNo, sourceSystem, externalOrderId, sourceVersion,
businessType: STORE_PICKUP | STORE_RETURN | DOOR_DELIVERY | DOOR_PICKUP,
executionStatus: UNASSIGNED | PLANNED | EN_ROUTE | IN_SERVICE | COMPLETED | CANCELLED,
feasibility: UNKNOWN | NORMAL | AT_RISK | INFEASIBLE,
slackMinutes: number | null,
promisedPickupAt, receivedAt,
pickupAddress, pickupLat?, pickupLng?, deliveryAddress, deliveryLat?, deliveryLng?,
storeCode, storeName?,
licensePlateSnapshot?, vehicleTypeSnapshot?,   // 仅展示，不参与调度
remark?, cancelledAt?,
currentAssignmentId?, createdAt, updatedAt
```

### 3.2 AssignmentV2

```text
id, orderId, driverId,
sequenceNo, slot: NONE | A | B | C,          // slot 由 sequenceNo 派生，只读
lockType: NONE | AUTO_FROZEN | MANUAL_LOCKED,
planVersion,
plannedDepartAt?, plannedPickupAt?, plannedCompleteAt?,
deadheadEtaMinutes?, serviceEtaMinutes?,
etaAvailable: boolean, etaUnavailableReason?,
departedAt?, arrivedAt?, completedAt?,
lastEtaCalculatedAt?
```

### 3.3 DriverV2

```text
id, name, storeCode,
onShift: boolean, shiftStartedAt?,
locationFreshness: FRESH | STALE | NONE,     // FRESH: capturedAt ≤ 120 秒
lastLocation?: { lat, lng, accuracyMeters, capturedAt },
slots: { A?: AssignmentSummary, B?: AssignmentSummary, C?: AssignmentSummary }
```

### 3.4 ServicePlanV2

```text
assignmentId,
modules: Array<CHARGING | REFUELING | WASHING | HANDOVER_FORMALITIES | RETURN_FORMALITIES>,
totalModuleMinutes,                            // 固定时长合计：30/5/10/10/5
revision, updatedAt, updatedBy
```

### 3.5 DispatchAlertV2

```text
id, orderId, type: INFEASIBLE,
status: OPEN | RESOLVED,
slackMinutesAtCreate, createdAt,
resolvedAt?, resolvedBy?: SYSTEM_RECALC | ORDER_MODIFIED | ORDER_CANCELLED,
historyRetained: true                          // 解决后记录保留
```

### 3.6 LocationSampleV2（上报）

```text
lat, lng, accuracyMeters, capturedAt
拒绝规则（逐条，不阻断整批）：
- accuracyMeters > 100        → skipped, reason=ACCURACY_TOO_LOW
- capturedAt 超前服务端 > 30s → skipped, reason=CLOCK_SKEW
- (driverId, capturedAt) 重复  → skipped, reason=DUPLICATE
```

## 4. 与调度核心的关系

- 本契约的 DTO 是页面与 API 的边界；调度核心只接收内部输入类型（Gate 2 定义），不直接消费 HTTP DTO。
- 车辆字段（`licensePlateSnapshot` / `vehicleTypeSnapshot`）永不出现在调度输入中。
- 外部字段（`sourceStatusRaw` 等）终止于 Adapter 与来源事件层，不出现在 §3 之外的响应中。

## 5. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-17 | Gate 0 首次冻结：路径、DTO、角色权限、状态流转引用、幂等、planVersion、错误码、traceId、时间格式与分页 |

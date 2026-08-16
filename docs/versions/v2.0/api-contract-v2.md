# 人车单 V2 API 契约

> 契约版本：`RCD-API-V2.0-R16-20260816`
> 状态：第二轮串行 API 审计返修契约已冻结；数据模型约束返修已通过，应用返修待对齐新基线
> 实施约束：本文件只冻结契约，不含任何代码；TypeScript DTO、错误类型和契约测试在 Gate 2 落地
> 上游依据：[PRD V2](prd-v2.md) · [数据架构 V2](data-architecture-v2.md) · [项目规则 V2](project-rules-v2.md)
> 代码事实：`codex/v2-gate3-app-candidate @ 958afca537b412fb972b6e180561a9b37022834d`

## 1. 通用约定

### 1.1 路径与版本

- V2 全部新接口位于 `/api/v2/**`，与 V1 路径（`/api/orders` 等）物理隔离。
- V1 **读**接口在兼容窗口内保持可用（经兼容层单向读 V2 事实）；V1 **写**接口在 V2 状态机切换开关开启后停用（410）。两个时点的冻结定义见兼容矩阵 §7：切换开关开启 ≠ 兼容窗口关闭。
- 第二轮增加调度员 V2 API 串行接线任务不授权删除 V1 路由：切换开关开启前 V1 读写继续运行；开启后仅 V1 写返回 410；并行验证 3A 通过且用户批准关闭兼容窗口后，V1 读接口与页面才整体下线。
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

```text
PageResultV2<T> = { items: T[], total: number, page: number, pageSize: number }
```

### 1.5 错误码（冻结）

| HTTP | code | 语义 | details 必含 |
|---:|---|---|---|
| 400 | `VALIDATION_FAILED` | 参数或字段校验失败 | `fields`（逐字段错误） |
| 400 | `ILLEGAL_TRANSITION` | 非法状态流转（见 PRD 10.1 矩阵） | `currentStatus`、`targetStatus` |
| 401 | `UNAUTHORIZED` | 未登录或 Ingest Key 无效 | — |
| 403 | `FORBIDDEN` | 角色无权限或越权访问他人资源 | — |
| 404 | `NOT_FOUND` | 资源不存在 | — |
| 409 | `PLAN_VERSION_CONFLICT` | 司机计划 `planVersion` 过期 | 单司机操作：`currentPlanVersion`；改派：`currentFromPlanVersion`、`currentToPlanVersion` |
| 409 | `DUPLICATE_OPERATION` | 并发重复操作（短锁冲突） | — |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超 1 MiB 或批次超 200 条 | `limit`、`observedBytes`（流式校验中止时为已读取字节数，语义是“至少”，不是完整体积）或 `actualRecords`（批次超条数时） |
| 422 | `LOCATION_INVALID` | 位置样本被拒（精度/时钟/过期） | `reason` |
| 500 | `INTERNAL_ERROR` | 未分类服务端错误 | — |
| 503 | `DEPENDENCY_UNAVAILABLE` | 高德 / Redis / 外部订单源不可用 | `dependency` |

- 自动重排与只读调度结果中的 ETA 不可用不是 503：正常返回，DTO 内 `etaAvailable: false` 并附 `etaUnavailableReason`；禁止假 ETA。手动分配/改派要创建 `MANUAL_LOCKED` 完整计划，适用 §2.1 的计划编辑例外：没有可用的真实或有效缓存 ETA 时不写入任何计划事实，返回 503 `DEPENDENCY_UNAVAILABLE`。

### 1.6 幂等与版本携带（冻结）

**命令分类与 `planVersion` 携带规则（封闭式，冻结）**：

```text
只有 分配 / 改派 / 撤回 / 解锁 四类计划编辑命令
要求客户端携带 expected*PlanVersion
  （改派为 expectedFromPlanVersion + expectedToPlanVersion 双版本）
  不匹配返回 409 PLAN_VERSION_CONFLICT

除此之外，所有业务事实、控制命令和系统重排触发
（包括但不限于：取消 / 可用性设置 / 上下班 / 出发 / 到达 / 完成 /
  订单资料修改 / 服务模块修改 / 位置变化 / 订单接入 / 周期基线校验）
均不携带客户端版本，由服务端对受影响订单和司机取短锁，
在事务内读取、校验并递增受影响司机的 planVersion
```

| 场景 | 幂等键 / 策略 |
|---|---|
| 订单接入 | Event 唯一键 `(sourceSystem, externalOrderId, sourceVersion)`；同版本重复到达返回已有处理结果（`replayed: true`）；新版本更新快照并生成来源事件；旧版本晚到不覆盖快照，计入 `skipped`（reason `STALE_VERSION`），仅记录来源事件（见数据架构 §3.3） |
| 司机执行事件（出发/到达/完成） | 状态机幂等：重复提交已生效的同一流转，返回 200 且 `data.replayed = true`；提交矩阵外流转返回 400 `ILLEGAL_TRANSITION` |
| 计划编辑命令（分配/撤回/解锁） | 携带 `expectedPlanVersion`（该工单所属/目标司机的计划版本）；不匹配返回 409 和 `currentPlanVersion`，客户端刷新后重试 |
| 改派 | 同时改变两名司机的计划，携带 `expectedFromPlanVersion`（原司机）与 `expectedToPlanVersion`（目标司机）；任一不匹配返回 409 和两个当前版本；两版本在同一事务中校验并各自递增 |
| 订单取消 | 状态机幂等：订单已是 `CANCELLED` 时重复取消返回 200 且 `data.replayed = true` |
| 可用性设置 | 幂等：重复设置为当前相同值返回 200 且 `data.replayed = true`，无任何副作用（不重复释放工单、不触发重排） |
| 位置上报 | 按 `(driverId, capturedAt)` 去重，重复样本静默忽略并计入 `skipped` |

分配、改派、撤回、解锁四类计划编辑命令没有独立幂等键，必须先在事务内校验客户端携带的 `expected*PlanVersion`，再判断状态与业务前置条件。版本不匹配一律返回 409 `PLAN_VERSION_CONFLICT`；不得仅凭当前状态相同、已有同类日志或已有 Assignment 推测为同一请求并返回 `replayed: true`。并发重复请求由调度短锁或版本冲突拒绝。

`planVersion` 归属司机计划聚合（每名司机一个计数器），不属于单个 Assignment；定义见词汇表 §6 与数据架构 §6。

### 1.7 角色（冻结）

| 角色 | 认证方式 | 说明 |
|---|---|---|
| `dispatcher` | 会话登录（沿用现有 auth，角色 admin） | 调度员 Web |
| `driver` | 会话登录（绑定 driverId） | 司机 H5；只能操作自己的资源 |
| `ingest` | `X-Ingest-Key` 或 `Authorization: Bearer`，Origin 白名单；**每个凭证绑定唯一 `sourceSystem`**，投递的 `IngestEnvelope.sourceSystem` 与凭证绑定不一致返回 403 `FORBIDDEN`（防止来源冒充写入他源唯一键空间） | 订单来源（插件/外部 API） |
| `system` | 服务端内部调用，不暴露公网 | 调度引擎、定时校验 |

### 1.8 框架适配边界（冻结）

- Next.js 15 将动态路由 `params`、页面 `searchParams` 与 `cookies()` 改为异步读取；这是服务端实现细节，不是 HTTP 契约变更。
- 本次适配没有新增、删除或改名任何对外路径与 HTTP 方法，没有改变鉴权主体、请求字段、响应字段、状态码、错误码、分页、幂等、版本或 traceId 语义。
- 任何后续框架升级若需要改变上述任一外部行为，必须先修改本契约并升级契约版本；不得以“框架兼容”为由静默改约。

## 2. 接口清单

### 2.1 调度员（dispatcher）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v2/map/snapshot` | 全局快照：上班司机位置 + 全部可见订单点位 + OPEN 预警计数 |
| GET | `/api/v2/orders` | 订单池分页；过滤：`executionStatus`、`feasibility`、`slot`、`storeCode`、`keyword` |
| GET | `/api/v2/orders/{orderId}` | 订单详情（含当前 Assignment、可行性、预警、修改历史摘要） |
| PATCH | `/api/v2/orders/{orderId}` | 修改 `promisedPickupAt` / `pickupAddress` / `deliveryAddress`；`reason` 必填；地址变化按下方地理编码语义提交，成功后立即重算 |
| POST | `/api/v2/orders/{orderId}/cancel` | 取消订单 `{ reason }`；合法前置状态 `UNASSIGNED / PLANNED / EN_ROUTE`；副作用见下方“取消语义” |
| GET | `/api/v2/drivers` | 司机列表；返回 `PageResultV2<DriverV2>`，含班次状态、可用性、位置新鲜度、A/B/C 摘要 |
| PATCH | `/api/v2/drivers/{driverId}/availability` | 设置 `{ availability: AVAILABLE 或 UNAVAILABLE, reason }`；设为 `UNAVAILABLE` 时未出发工单全部释放并触发重排，执行中（`EN_ROUTE`/`IN_SERVICE`）工单继续执行到完成；重复设置相同值返回 200 且 `data.replayed = true`，无副作用（§1.6） |
| GET | `/api/v2/drivers/{driverId}/plan` | 该司机 A/B/C 时间轴（含 `planVersion`、衔接 ETA、模块时长、迟到风险） |
| POST | `/api/v2/assignments` | 手动分配 `{ orderId, driverId, reason, expectedPlanVersion }` → 完整 `MANUAL_LOCKED` 计划；`expectedPlanVersion` 为目标司机计划版本；客户端不指定槽位 |
| POST | `/api/v2/assignments/{assignmentId}/reassign` | 改派 `{ toDriverId, reason, expectedFromPlanVersion, expectedToPlanVersion }` → 原/目标司机完整计划；`toDriverId` 等于当前司机返回 400；`IN_SERVICE` 服务端拒绝 |
| POST | `/api/v2/assignments/{assignmentId}/withdraw` | 撤回 → `UNASSIGNED`，`{ reason, expectedPlanVersion }`（该工单所属司机计划版本） |
| POST | `/api/v2/assignments/{assignmentId}/unlock` | 解除 `MANUAL_LOCKED`，`{ reason, expectedPlanVersion }`（同上） |
| GET | `/api/v2/alerts` | 预警分页；过滤 `status=OPEN/RESOLVED`；预警解决由系统在重算后自动执行，无手工 resolve 接口 |
| GET | `/api/v2/logs` | 操作日志分页；过滤 `orderId` / `driverId` / `traceId` / `action` |

**手动分配/改派完整计划语义（冻结）**：

- 客户端只指定目标司机，不新增槽位字段；服务端使用 V2 调度核心，在指定目标司机范围内按既有可行性与择优规则选择 A/B/C 槽位。
- 新建 `MANUAL_LOCKED` Assignment 前必须得到非空 `sequenceNo`、`plannedDepartAt`、`plannedPickupAt`、`plannedCompleteAt`、`deadheadEtaMinutes`、`serviceEtaMinutes` 与 `lastEtaCalculatedAt`；`etaAvailable = true`。禁止先写不完整锁定工单再等待后续重排补算。
- 快照和 ETA 在数据库事务外计算；写事务内重新锁定受影响订单与司机、再次校验单/双 `planVersion`，再原子提交 Assignment、订单、受影响司机版本、日志和 outbox。改派必须同时保持原司机与目标司机的剩余计划完整。
- 指定司机没有可行 A/B/C 槽位时返回 400 `VALIDATION_FAILED`，`details.fields.driverId`（改派为 `toDriverId`）说明无可行计划，且不得写入任何事实。
- 没有可用的真实或有效缓存 ETA 时返回 503 `DEPENDENCY_UNAVAILABLE`，`details.dependency = "AMAP"`，且不得写入 Assignment、订单状态、版本、日志或 outbox。

**订单地址修改与地理编码语义（冻结）**：

- `pickupAddress` 或 `deliveryAddress` 实际变化时，服务端先在数据库事务外完成对应地址的高德地理编码；仅修改 `promisedPickupAt` 不调用地理编码。
- 全部所需地理编码成功后，在同一数据库事务内原子提交地址与对应坐标，再写版本、日志和 outbox；不得提交“新地址 + 空坐标”的中间事实。
- 高德失败、超时或返回空结果时返回 503 `DEPENDENCY_UNAVAILABLE`，`details.dependency = "AMAP"`；订单、坐标、`planVersion`、日志和 outbox 保持原状。

**取消语义（冻结）**：

- 允许角色：调度员（本端点）；来源系统经 ingest 投递取消版本（见 §2.3），不直接调用本端点。
- 合法前置状态：`UNASSIGNED / PLANNED / EN_ROUTE`；`IN_SERVICE / COMPLETED` 返回 400 `ILLEGAL_TRANSITION`（含 `currentStatus/targetStatus`）。
- 幂等：订单已 `CANCELLED` 时重复取消返回 200 且 `data.replayed = true`。
- 副作用：终止有效 Assignment 并释放槽位；递增受影响司机 `planVersion`；该订单 `OPEN` 预警转 `RESOLVED`（`resolvedBy = ORDER_CANCELLED`）；触发受影响司机重排；写操作日志（含 reason、traceId）。

### 2.2 司机（driver）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v2/driver/shift/start` | 上班；开始参与调度 |
| POST | `/api/v2/driver/shift/end` | 下班；执行中（`EN_ROUTE`/`IN_SERVICE` 存在）返回 400 `ILLEGAL_TRANSITION`；未出发任务全部释放 |
| GET | `/api/v2/driver/map` | 所有上班司机位置（全局位置视图，不含他人订单详情） |
| GET | `/api/v2/driver/tasks` | 本人 A/B/C 详情 |
| GET | `/api/v2/driver/orders/unassigned` | 未分配订单列表（只读） |
| PUT | `/api/v2/driver/tasks/{assignmentId}/modules` | 设置服务模块组合（多选，无顺序）；执行中允许修改；立即重算并写日志；属业务事实命令，**不携带 `expectedPlanVersion`**（§1.6 封闭式分类），版本由服务端事务内递增 |
| POST | `/api/v2/driver/tasks/{assignmentId}/depart` | 出发：`PLANNED → EN_ROUTE`，锁定 `AUTO_FROZEN` |
| POST | `/api/v2/driver/tasks/{assignmentId}/arrive` | 到达：`EN_ROUTE → IN_SERVICE`，实际计时开始 |
| POST | `/api/v2/driver/tasks/{assignmentId}/complete` | 完成：`IN_SERVICE → COMPLETED`，触发重排 |
| POST | `/api/v2/driver/location` | 批量位置上报 `{ samples: [{ lat, lng, accuracyMeters, capturedAt }] }`；逐条校验（§1.6 / 数据架构 7.1） |

- 司机访问非本人 `assignmentId` 返回 403 `FORBIDDEN`。
- 司机无拒单和改派接口；此类操作不存在于 driver 路径下。
- 第二轮 H5 地图不新增聚合路径，固定组合本节三个读取接口：`/driver/map`、`/driver/tasks` 与 `/driver/orders/unassigned`；客户端每 15 秒读取，位置上报仍按数据架构的 30 秒目标频率。
- `/driver/map` 保持返回 `DriverV2[]`，只含上班司机的位置层；`slots` 不得用于泄露他人订单详情。`lastLocation` 只有在 `lat/lng/accuracyMeters/capturedAt` 完整时才整体出现。
- `/driver/tasks` 只返回本人 A/B/C，并为地图展示向 `AssignmentSummaryV2` 向后兼容增加 `businessType`、`lockType`、`feasibility`、`promisedPickupAt`、`pickupPoint`、`deliveryPoint`、`pickupAddress`、`deliveryAddress`。
- `/driver/orders/unassigned` 只返回尚未分配订单的 `DriverOrderMarkerV2[]`；订单分配给任一司机后立即从结果移除。任何司机读取其他司机已分配订单详情返回 403。
- 三个读取接口均从已认证身份解析调用者 `driverId`；query/body 中出现的 `driverId` 不得改变授权主体。浏览器不得接收 `AMAP_SERVER_KEY`。

### 2.3 订单接入（ingest）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v2/ingest/orders` | `IngestEnvelope` 批量接入；限制：单批 ≤ 200 条、体积 ≤ 1 MiB（流式校验）；逐条返回 `success / skipped / failed` 及 reason、traceId |
| OPTIONS | `/api/v2/ingest/orders` | CORS 预检；白名单外 Origin 返回 403 |

**输入信封 `IngestEnvelope`（冻结）**：

```text
IngestEnvelope:
  sourceSystem: HALUO | PLUGIN | API      // V1_IMPORT 仅迁移/V1 写兼容使用，V2 在线投递被拒（400）
  records: IngestRecord[]                  // 1–200 条

IngestRecord（规范化接入 DTO：字段为 Canonical 命名，由来源侧或 Adapter 完成
             规范化，不是外部原文透传；字段语义与 CanonicalOrder §3 对应）:
  必填: externalOrderId, sourceVersion, sourceStatusRaw,
        orderNo, businessType, promisedPickupAt,
        pickupAddress, deliveryAddress, storeCode
  可选: pickupLat/pickupLng, deliveryLat/deliveryLng,
        licensePlateSnapshot, vehicleTypeSnapshot,
        storeName, city, district, remark, cancelledAt
```

- `receivedAt` 由服务端生成，输入中出现即忽略；V2 在线输入的 `sourceVersion` 必须符合数据架构 §3.3 冻结格式（UTC `Z` 固定毫秒精度 ISO 8601 或零填充定长序号），禁止传入兼容基线值 `"v1-migration"`。
- 凭证与来源绑定：`sourceSystem` 必须等于当前 ingest 凭证绑定的来源，否则整批 403 `FORBIDDEN`（§1.7）。
- 唯一键与版本覆盖规则按数据架构 §3.3 执行：同版本 → 返回已有处理结果（`replayed`）并计入 `skipped`；新版本 → 更新快照；旧版本晚到 → `skipped`（reason `STALE_VERSION`），不覆盖快照。若当前快照版本为 `"v1-migration"`，比较器必须无条件把首个合法在线版本视为较新版本。
- **来源取消**：新版本记录中 `sourceStatusRaw` 映射为“已取消”或携带 `cancelledAt` 时，Adapter 生成内部取消命令，按 §2.1 取消语义与 PRD 10.1 矩阵执行。
- **来源取消遇终态/不可取消状态（冻结）**：订单已处于 `IN_SERVICE / COMPLETED` 时——来源事件照常接收并记录（来源事实入库不被拒绝）；内部取消命令**不执行**，订单执行状态保持不变；该记录计入 `success`，reason `FOLLOW_UP_REQUIRED`；**不返回整批 400**；同时写入人工跟进操作日志。矩阵的 400 只约束内部状态流转命令，不约束来源事实入库。
- 外部原始状态仅写入 `sourceStatusRaw` 与来源事件，不得直接映射为内部执行状态之外的写入。
- **`sourceStatusRaw` 存储边界（冻结）**：`sourceStatusRaw` 可经过 Adapter 流转，但**仅持久化到 `OrderSourceEvent`**；`Order` 快照和任何调度 DTO（§3）不保存、不暴露该字段。
- 重复（库内已存在同幂等键、批内重复、旧版本晚到）计入 `skipped`，不计入 `failed`。
- 单条记录引用不存在的 `storeCode` 时计入 `failed`，reason 为 `STORE_NOT_FOUND`；不阻断同批其他记录。

### 2.4 系统（system）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v2/health` | 匿名存活探针；只返回 `{ status: "ok" }` 与 traceId，**不暴露**数据库 / Redis / 高德的可达状态 |
| GET | `/api/v2/health/readiness` | 详细依赖可达状态（db / redis / amap）；仅限 `dispatcher` 会话或 `system` 内部调用，匿名访问返回 401 |
| POST | `/api/v2/system/dispatch-events/process?limit=1..100` | 按 UTC 十分钟稳定桶幂等确保当前 `BASELINE_RECALCULATION` 已入队，再领取并处理待重试的调度 outbox 事件；使用 `Authorization: Bearer <INTERNAL_CRON_SECRET>` 或 `X-Internal-Key`，未鉴权返回 401；供每分钟周期任务调用，不面向浏览器 |

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

`GET /api/v2/orders/{orderId}` 的 `data.modificationHistory` 固定为 `OrderModificationSummaryV2[]`：

```text
OrderModificationScalarV2 = string | number | boolean | null

OrderModificationSummaryV2 = {
  id: string,
  operator: { id: string, name: string },
  reason: string | null,
  changes: Array<{
    field: string,
    before: OrderModificationScalarV2,
    after: OrderModificationScalarV2
  }>,
  traceId: string | null,
  createdAt: ISO 8601 with timezone
}
```

- 只包含 `ORDER_MODIFY` 日志，按 `createdAt` 新到旧排序；同一摘要的 `changes` 按 `field` 稳定排序。
- 不向前端暴露原始 `metadataJson`；本段只冻结修改历史字段，不扩展其他订单详情字段。

### 3.2 AssignmentV2

```text
id, orderId, driverId,
sequenceNo, slot: NONE | A | B | C,          // slot 由 sequenceNo 派生，只读
lockType: NONE | AUTO_FROZEN | MANUAL_LOCKED,
plannedDepartAt?, plannedPickupAt?, plannedCompleteAt?,
deadheadEtaMinutes?, serviceEtaMinutes?,
etaAvailable: boolean, etaUnavailableReason?,
departedAt?, arrivedAt?, completedAt?,
lastEtaCalculatedAt?
// planVersion 不在 Assignment 上：归属司机计划聚合，见 DriverV2 与数据架构 §6
```

### 3.3 DriverV2

```text
id, name, storeCode,
onShift: boolean, shiftStartedAt?,
availability: AVAILABLE | UNAVAILABLE,
planVersion,                                 // 司机计划聚合版本，写操作的 expected* 对照值
locationFreshness: FRESH | STALE | NONE,     // FRESH: capturedAt ≤ 120 秒
lastLocation?: { lat, lng, accuracyMeters, capturedAt },
slots: { A?: AssignmentSummary, B?: AssignmentSummary, C?: AssignmentSummary }
```

候选司机 = `onShift = true` 且 `availability = AVAILABLE` 且 `locationFreshness = FRESH`（PRD §6.1）。

`GET /api/v2/drivers` 的 `data` 固定为 `PageResultV2<DriverV2>`；`GET /api/v2/driver/map` 继续返回 `DriverV2[]`，两者不得混用。

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
- accuracyMeters > 100                → skipped, reason=ACCURACY_TOO_LOW
- capturedAt 超前服务端 > 30s         → skipped, reason=CLOCK_SKEW
- capturedAt 早于服务端 > 120s        → skipped, reason=EXPIRED_AT_RECEIPT
- (driverId, capturedAt) 重复          → skipped, reason=DUPLICATE
```

### 3.7 DriverOrderMarkerV2（司机 H5 地图）

```text
orderId, orderNo,
businessType: STORE_PICKUP | STORE_RETURN | DOOR_DELIVERY | DOOR_PICKUP,
executionStatus: UNASSIGNED | PLANNED | EN_ROUTE | IN_SERVICE,
slot: NONE | A | B | C,
lockType: NONE | AUTO_FROZEN | MANUAL_LOCKED,
feasibility: UNKNOWN | NORMAL | AT_RISK | INFEASIBLE,
promisedPickupAt,
pickupPoint?: { lat, lng }, deliveryPoint?: { lat, lng },
pickupAddress?, deliveryAddress?
```

- 本人 A/B/C 可返回 `slot=A/B/C`；未分配池只返回 `executionStatus=UNASSIGNED` 与 `slot=NONE`。
- 坐标或展示地址缺失时整体省略对应可选字段，禁止填充 `0`、空字符串或假坐标。
- 该 DTO 不含客户、手机号、来源原文、其他司机身份或车辆匹配字段。

### 3.8 MapSnapshotV2（调度员地图）

`GET /api/v2/map/snapshot` 的统一 V2 响应包装内，`data` 顶层字段精确为：

```text
MapSnapshotV2 = {
  drivers: DriverV2[],
  orders: OrderV2[],
  openAlertCount: number
}
```

- `openAlertCount` 是非负整数，只统计 `OPEN` 预警。
- 顶层不增加 `generatedAt`、`stores` 或 `alerts`；如未来需要，必须先修订契约。

## 4. 与调度核心的关系

- 本契约的 DTO 是页面与 API 的边界；调度核心只接收内部输入类型（Gate 2 定义），不直接消费 HTTP DTO。
- 车辆字段（`licensePlateSnapshot` / `vehicleTypeSnapshot`）永不出现在调度输入中。
- 外部字段（`sourceStatusRaw` 等）终止于 Adapter 与来源事件层，不出现在 §3 之外的响应中。

## 5. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-17 | Gate 0 首次冻结：路径、DTO、角色权限、状态流转引用、幂等、planVersion、错误码、traceId、时间格式与分页 |
| V2.0-r1 | 2026-07-17 | Gate 0 二轮返修：`planVersion` 归属司机计划聚合，改派改为双版本（`expectedFromPlanVersion/expectedToPlanVersion`）；新增订单取消端点与取消语义；冻结 `IngestEnvelope` 与版本覆盖规则；新增 `DriverAvailability` 字段与设置端点；health 拆分匿名存活/内部 readiness；413 details 改 `observedBytes`；位置拒收补 `EXPIRED_AT_RECEIPT` |
| V2.0-r2 | 2026-07-17 | Gate 0 三轮返修：§1.6 冻结命令两分类（计划编辑命令带 `expected*`，业务事实/控制命令服务端事务内递增）；§2.3 冻结来源取消遇终态的返回语义（`success` + `FOLLOW_UP_REQUIRED`，不整批 400）与 `sourceStatusRaw` 存储边界（仅 `OrderSourceEvent`）；§1.1 区分 V1 读/写接口存续时点；§1.7 ingest 凭证绑定唯一 `sourceSystem`；可用性设置幂等 `replayed` |
| V2.0-r3 | 2026-07-17 | Gate 0 四轮返修：§1.6 版本携带规则改封闭式（仅四类计划编辑命令带版本，其余含模块修改/位置变化/订单接入/周期校验一律服务端递增）；§2.2 模块端点标注不携带 `expectedPlanVersion` |
| V2.0-r4 | 2026-07-18 | Gate 1 冲突裁决：V2 在线 ingest 禁止 `"v1-migration"`；版本比较器将该迁移/V1 兼容基线恒视为最旧版本 |
| V2.0-r5 | 2026-07-26 | Gate 3-2 审查返修：补 `STORE_NOT_FOUND` 单条失败 reason；登记受内部密钥保护的 outbox 周期补偿端点 |
| V2.0-r6 | 2026-07-26 | Gate 3-2 二次返修：系统 worker 每次调用先以 UTC 十分钟稳定桶幂等生成基线校验事件，再消费 outbox |
| V2.0-r7 | 2026-08-01 | 对齐应用候选 `7f60fd0d55783d1f057c814e46a3dab7f73e2416`：登记 Next.js 15 异步动态 API 仅属内部适配；HTTP 路径、方法、鉴权、DTO、状态码、错误码与 traceId 语义零变化 |
| V2.0-r8 | 2026-08-01 | 对齐最终候选 `3dea9260865f7e6ed42938d83e370e3823d31a2d`：仅修复两份 rollback 的依赖拆除顺序；外部 HTTP 契约零变化 |
| V2.0-r9 | 2026-08-02 | 对齐部署可用性返修后的唯一候选 `169f2ad8b27f9f0be2d4630144315694656b6a67`：V2 health/readiness 按既有契约实现，外部业务 HTTP 契约零变化 |
| V2.0-r10 | 2026-08-02 | 对齐部署入口加固候选 `7378303f513d92e781a7930cfff7e14269ec3126`：受保护 readiness 与入口 trace 过滤沿用既有契约，外部业务 HTTP 契约零变化 |
| V2.0-r11 | 2026-08-03 | 对齐 Compose 命令修正候选 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`：只修改部署 README 与部署测试，HTTP 方法、路径、鉴权、DTO、状态码、错误码与 traceId 语义零变化 |
| V2.0-r12 | 2026-08-08 | 对齐可观测性候选 `4eb3b4857caae9730eb70dd9f2fb152bd8972ca0`：发布 revision、日志字段、Nginx 访问日志与轮转返修不改变 HTTP 方法、路径、鉴权、DTO、状态码、错误码或 traceId 语义 |
| V2.0-r13 | 2026-08-10 | 对齐当前候选 `958afca537b412fb972b6e180561a9b37022834d`：Gate 3 最小 E2E、ETA 重试、司机地图读取、H5 显示和全实例高德 3 QPS 限流返修均保持既有 HTTP 方法、路径、鉴权、DTO、状态码、错误码与 traceId 语义 |
| V2.0-r14 | 2026-08-13 | 第二轮司机 H5 再冻结：不新增地图聚合路径，固定组合 `/driver/map`、`/driver/tasks`、`/driver/orders/unassigned`；保持 `DriverV2[]` 向后兼容并新增 `DriverOrderMarkerV2`/本人任务地图字段、15 秒读取和身份边界；同时明确调度员 V2 API 接线不授权提前删除 V1 |
| V2.0-r15 | 2026-08-16 | 串行 API 审计返修冻结：计划编辑命令严格先校验版本且不推测 replay；手动分配/改派必须在提交前形成指定司机的完整 A/B/C 锁定计划；地址变化先地理编码再原子提交；冻结 `MapSnapshotV2` 顶层、订单修改历史摘要和 `/drivers` 分页 DTO |
| V2.0-r16 | 2026-08-16 | 统一 `DEPENDENCY_UNAVAILABLE.details.dependency` 为共享 DTO 已冻结的大写枚举 `AMAP`；修正 r15 两处小写笔误，不改变错误码、状态码或实现范围 |

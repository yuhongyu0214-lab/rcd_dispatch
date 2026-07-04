# demo_v12 接口契约草案

版本：2026-06-20  
来源：`.superpowers/live-preview/demo_v12.html` 当前定型版  
用途：把前端 demo 的 mock 行为沉淀为正式 API 契约，供后续数据库、后端算法和前后端联调使用。

## 1. 总规则

### 1.1 统一响应格式

所有 API Route 必须通过 `src/lib/api-response.ts` 的 `ok()` / `fail()` 返回。

```ts
type ApiSuccess<T> = {
  success: true;
  data: T;
  error: null;
  traceId: string;
};

type ApiFailure = {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId: string;
};
```

响应头：

- `X-Trace-Id: <traceId>`

禁止：

- 裸 `NextResponse.json({ ... })`。
- API Route 中手动 `throw Error`。
- 绕过统一响应格式返回第三方原始结构。

### 1.2 分页格式

```ts
type PageRequest = {
  page?: number;      // 默认 1
  pageSize?: 20 | 50 | 100;
};

type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
```

### 1.3 状态映射

正式数据库状态使用英文枚举，前端展示使用中文标签。

| 正式枚举 | 前端展示建议 | 说明 |
|---|---|---|
| `UNIMPORTED` | 未导入 | 外部订单未进入系统 |
| `PENDING` | 待分配 / 待取车 | 已入库，待调度 |
| `RECOMMENDING` | 推荐中 | 推荐派单计算中 |
| `ASSIGNED` | 已派单 | 调度员已派司机 |
| `ACCEPTED` | 已接单 | 司机已接单 |
| `IN_PROGRESS` | 执行中 / 待还车 | 司机任务执行中 |
| `COMPLETED` | 已完成 | 终态 |
| `RECYCLED` | 已回收 | 过渡态，回到 PENDING |
| `CANCELLED` | 已取消 | 终态 |

车辆与司机管理可额外展示业务进度标签，如 `清洁中`、`补能中`、`已整备`，但不得替代订单生命周期枚举。

### 1.4 权限

当前 demo 默认运营管理员。正式接口在 V1 可先使用管理员权限。

建议角色：

- `admin`：调度员/运营管理员。
- `system`：外部同步任务、mock adapter。
- `driver`：司机端 API 契约层。

## 2. DTO

### 2.1 OrderDTO

```ts
type OrderDTO = {
  id: string;
  type: "RENTAL" | "RETURN" | "TRANSFER";
  status:
    | "UNIMPORTED"
    | "PENDING"
    | "RECOMMENDING"
    | "ASSIGNED"
    | "ACCEPTED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "RECYCLED"
    | "CANCELLED";
  displayStatus: string;
  storeId: string;
  storeName: string;
  plate: string;
  driverId?: string | null;
  driverName?: string | null;
  pickupName: string;
  returnName: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  progress?: "CLEANING" | "ENERGY_REFILL" | "READY" | "NONE";
  progressText?: string;
  locked: boolean;
  source: string;
  traceId: string;
  insertedAt: string;
};
```

### 2.2 VehicleDTO

```ts
type VehicleDTO = {
  id: string;
  plate: string;
  model: string;
  status: "DISPATCHABLE" | "IN_ORDER" | "CLEANING" | "ENERGY_REFILL" | "GPS_OFFLINE" | "UNAVAILABLE";
  statusText: string;
  storeId: string;
  storeName: string;
  gpsStatus: "ONLINE" | "OFFLINE";
  gpsUpdatedAt?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  currentOrderId?: string | null;
  monthCompletedOrders: number;
  monthRevenueCents: number;
  currentLocationText: string;
  dispatchable: boolean;
  locked: boolean;
};
```

### 2.3 DriverDTO

```ts
type DriverDTO = {
  id: string;
  name: string;
  status: "S1" | "S2" | "S3" | "S4" | "OFFLINE" | "UNAVAILABLE";
  statusText: "门店空闲" | "返程空闲" | "门店忙碌" | "订单忙碌" | "离线" | "暂不可用";
  vehicleId?: string | null;
  plate?: string | null;
  storeId: string;
  storeName: string;
  etaMinutes?: number | null;
  load: number;
  dispatchable: boolean;
  currentOrderId?: string | null;
  lat?: number | null;
  lng?: number | null;
};
```

### 2.4 DriverWorkOrderDTO

```ts
type DriverWorkOrderDTO = {
  driverId: string;
  previous?: {
    orderId: string;
    statusText: string;
    finishedAt?: string;
  } | null;
  current?: {
    orderId: string;
    progressText: string;
    estimatedFinishedAt?: string;
  } | null;
  next?: {
    orderId: string;
    statusText: string;
    scheduledStartAt?: string;
  } | null;
};
```

### 2.5 MapPointDTO

```ts
type MapPointDTO = {
  id: string;
  kind: "orders" | "drivers" | "vehicles" | "stores" | "alerts";
  lat: number;
  lng: number;
  icon: "drop" | "wheel" | "car" | "house" | "alert";
  colorToken: "warning" | "success" | "info" | "accent" | "danger" | "muted";
  label: string;
  statusText?: string;
  refId?: string;
};
```

### 2.6 AlertDTO

```ts
type AlertDTO = {
  id: string;
  type: "ORDER_TIMEOUT" | "ETA_EXCEEDED" | "GPS_OFFLINE" | "LOW_FUEL" | "GEOCODE_FAILED";
  typeText: string;
  refKind: "orders" | "drivers" | "vehicles";
  refId: string;
  targetText: string;
  thresholdMinutes: number;
  actualMinutes: number;
  exceededMinutes: number;
  message: string;
  createdAt: string;
};
```

### 2.7 OperationLogDTO

```ts
type OperationLogDTO = {
  id: string;
  action: "ORDER_INGESTED" | "DISPATCH_ASSIGNED" | "REASSIGNED" | "REVOKED" | "VEHICLE_SYNCED" | "MANUAL_ALERT";
  actionText: string;
  orderId?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  licensePlate?: string | null;
  operator: string;
  traceId: string;
  result: string;
  timestamp: string;
};
```

## 3. 端点契约

### 3.1 注册与登录

归属阶段：`repo-bootstrap`，后续可由 Auth.js/NextAuth 承接。

#### POST `/api/auth/register`

前期仅管理员测试权限。

请求：

```json
{
  "phone": "13800000000",
  "password": "admin123"
}
```

规则：

- 账号为空：`请输入账号`。
- 密码为空：`请输入密码`。
- 注册成功后写入数据库，密码使用 bcrypt 哈希保存。
- 默认 `role = admin`。
- 注册成功后前端返回登录页。

响应：

```json
{
  "success": true,
  "data": { "userId": "usr_001", "role": "admin" },
  "error": null,
  "traceId": "trc_xxx"
}
```

#### POST `/api/auth/login`

请求：

```json
{
  "phone": "13800000000",
  "password": "admin123"
}
```

规则：

- 账号为空：`请输入账号`。
- 密码为空：`请输入密码`。
- 后端数据库无匹配或密码错误：`账号/密码错误`。

### 3.2 订单池

#### POST `/api/orders/ingest`

归属阶段：`order-import` / `integration-adapter`。  
用途：外部订单自动传入，前端不提供单独导入页面。

请求：

```json
{
  "source": "HALUO_MOCK",
  "orders": [
    {
      "externalOrderId": "D3832",
      "type": "RENTAL",
      "plate": "沪A·73K21",
      "storeName": "上海虹桥门店",
      "pickupAddress": "上海市闵行区虹桥T2停车楼",
      "returnAddress": "上海市静安区南京西路1515号",
      "scheduledStartAt": "2026-06-20T10:00:00+08:00",
      "scheduledEndAt": "2026-06-20T12:00:00+08:00"
    }
  ]
}
```

响应：

```ts
type OrderIngestResult = {
  importBatchId: string;
  successCount: number;
  failedCount: number;
  warningCount: number;
  rowErrors: Array<{
    row: number;
    field: string;
    message: string;
  }>;
};
```

规则：

- 成功订单写入订单池，初始状态为 `PENDING`。
- 地址转坐标结果写库，不在订单详情前端直接展示经纬度。
- 每条成功记录写入 operation_logs。

#### GET `/api/orders`

归属阶段：`admin-workflow`。

查询：

```ts
type OrderQuery = PageRequest & {
  keyword?: string;
  timeWindowHours?: 2 | 4 | 6;
  displayStatus?: "PICKUP_PENDING" | "RETURN_PENDING";
  includeCompleted?: boolean; // 订单池默认 false
};
```

响应：

```ts
type OrdersResponse = PageResult<OrderDTO>;
```

规则：

- 订单池默认不返回 `COMPLETED`。
- 支持每页 20 / 50 / 100。

#### GET `/api/orders/:id`

返回单条订单详情。

#### GET `/api/orders/:id/logs`

返回订单关联日志，供“查看日志”入口使用。

### 3.3 地图看板

#### GET `/api/map`

归属阶段：`map-board`。

查询：

```ts
type MapQuery = {
  keyword?: string;
  object?: "orders" | "drivers" | "vehicles" | "alerts";
  timeWindowHours?: 2 | 4 | 6;
  orderDisplayStatus?: "PICKUP_PENDING" | "RETURN_PENDING";
};
```

响应：

```ts
type MapResponse = {
  points: MapPointDTO[];
  kpis: Array<{ label: string; value: string | number }>;
  lastRefreshedAt: string;
};
```

规则：

- 订单、司机、车辆、门店、预警均返回点位。
- 前端不做图层隐藏，只根据当前对象做高亮。
- 刷新点位不重置视图。

#### GET `/api/map/route`

查询：

```ts
type RouteQuery = {
  orderId: string;
};
```

响应：

```ts
type RouteResponse = {
  orderId: string;
  polyline: Array<{ lat: number; lng: number }>;
  distanceMeters?: number;
  etaMinutes?: number;
  provider: "AMAP" | "MOCK";
};
```

规则：

- 高德 API 失败时返回 mock 或降级结果，不抛异常。
- 错误日志必须包含 traceId。

### 3.4 司机管理

#### GET `/api/drivers`

归属阶段：`map-board` / `admin-workflow`。

查询：

```ts
type DriverQuery = {
  keyword?: string;
  status?: "S1" | "S2" | "S3" | "S4" | "OFFLINE" | "UNAVAILABLE";
  dispatchableOnly?: boolean;
};
```

响应：

```ts
type DriversResponse = {
  items: DriverDTO[];
  kpis: Array<{ label: string; value: string | number }>;
};
```

#### GET `/api/drivers/:id/work-orders`

用途：司机工单进度轴。

响应：

```ts
type DriverWorkOrdersResponse = DriverWorkOrderDTO;
```

### 3.5 车辆管理

#### POST `/api/vehicles/ingest`

归属阶段：`integration-adapter`。  
用途：车辆基础信息、GPS、经营指标、锁单和是否参与调度字段同步。

请求：

```json
{
  "source": "GPS_MOCK",
  "vehicles": [
    {
      "plate": "沪A·73K21",
      "model": "别克 GL8",
      "gpsLat": 31.1942,
      "gpsLng": 121.3268,
      "gpsUpdatedAt": "2026-06-20T09:42:00+08:00",
      "storeName": "上海虹桥门店",
      "currentLocationText": "虹桥T2停车楼"
    }
  ]
}
```

#### GET `/api/vehicles`

归属阶段：`admin-workflow` / `integration-adapter`。

查询：

```ts
type VehicleQuery = PageRequest & {
  keyword?: string;      // 模糊查车牌、车型、门店、GPS 状态
  plate?: string;
  model?: string;
  storeId?: string;
  gpsStatus?: "ONLINE" | "OFFLINE";
  dispatchableOnly?: boolean;
};
```

响应：

```ts
type VehiclesResponse = PageResult<VehicleDTO> & {
  kpis: Array<{ label: string; value: string | number }>;
};
```

前端规则：

- 当前 demo 的车辆明细局部搜索是前端筛选。
- 正式接数据库后，文本输入 300-500ms debounce 后请求此接口。
- 不需要“查询/提交”按钮。

### 3.6 推荐派单

#### POST `/api/dispatch/recommend`

归属阶段：`dispatch-rule-v1`。

请求：

```json
{
  "orderId": "D3832",
  "limit": 3
}
```

响应：

```ts
type DispatchRecommendResponse = {
  outcome: "DISPATCHED" | "PENDING" | "MANUAL";
  reason?: "NO_DRIVER" | "ETA_EXCEEDED";
  topN: Array<{
    driver: DriverDTO;
    etaMinutes: number;
    priority: number;
    loadPenalty: number;
    reason?: string;
  }>;
};
```

规则：

- 无可用司机：`PENDING / NO_DRIVER`。
- 最优 ETA >= 120：`MANUAL / ETA_EXCEEDED`。
- 高德失败：该司机 `etaMinutes = 9999`，排在末尾，写 `logger.warn`。

#### POST `/api/dispatch/confirm`

归属阶段：`dispatch-rule-v1`。

请求：

```json
{
  "orderId": "D3832",
  "driverId": "DRV-021"
}
```

规则：

- 必须使用 Prisma 事务写入 assignment。
- 必须防止并发重复派单。
- 成功后写 operation_logs。

### 3.7 调度员操作闭环

#### POST `/api/assignments/manual`

手动派单。

请求：

```json
{
  "orderId": "D3832",
  "driverId": "DRV-021"
}
```

#### POST `/api/assignments/reassign`

改派。

请求：

```json
{
  "orderId": "D3836",
  "fromDriverId": "DRV-066",
  "toDriverId": "DRV-021",
  "reason": "司机临时不可用"
}
```

规则：

- 写 operation_logs，记录原司机、新司机、原因、traceId。
- 保留历史 assignment。

#### POST `/api/assignments/revoke`

撤回。

请求：

```json
{
  "orderId": "D3836",
  "assignmentId": "asg_001",
  "reason": "订单信息变化"
}
```

规则：

- 状态流转：`ASSIGNED -> RECYCLED -> PENDING`。
- 解锁司机和车辆。
- 写 operation_logs。

### 3.8 预警中心

#### GET `/api/alerts`

归属阶段：`logging-observe` / `admin-workflow`。

查询：

```ts
type AlertQuery = {
  keyword?: string;
  sort?: "thresholdExceededDuration";
};
```

响应：

```ts
type AlertsResponse = {
  items: AlertDTO[];
};
```

规则：

- 默认按 `exceededMinutes desc` 排序。
- 不按类型分组。

#### POST `/api/alerts/:id/manual`

用途：转人工处理。

规则：

- 仅记录日志，不直接改变订单状态机。

### 3.9 日志查询

#### GET `/api/logs`

归属阶段：`logging-observe`。

查询：

```ts
type LogQuery = PageRequest & {
  keyword?: string;
  orderId?: string;
  driverId?: string;
  licensePlate?: string;
  action?: OperationLogDTO["action"];
  traceId?: string;
};
```

响应：

```ts
type LogsResponse = PageResult<OperationLogDTO>;
```

规则：

- 默认按时间倒序。
- 导入、派单、改派、撤回、runDispatch 都必须可追踪。

## 4. 前端请求策略

### 4.1 自动筛选

无需提交按钮的筛选策略：

- 下拉筛选：立即请求。
- 文本模糊筛选：300-500ms debounce。
- 当前页内局部小数据：可前端筛选。
- 跨分页、跨门店、实时 GPS：必须请求后端。

### 4.2 Loading 与错误

每个可请求区域需支持：

- `idle`
- `loading`
- `success`
- `empty`
- `error`

错误文案：

- 用户可理解。
- 不暴露数据库或第三方原始错误。
- 详情写入结构化日志。

## 5. Worktree 拆分映射

| 能力 | Endpoint | 所属阶段 |
|---|---|---|
| 注册 / 登录 | `/api/auth/register`, `/api/auth/login` | `repo-bootstrap` |
| 订单自动传入 | `POST /api/orders/ingest` | `order-import` / `integration-adapter` |
| 订单池查询 | `GET /api/orders` | `admin-workflow` |
| 地图点位 | `GET /api/map` | `map-board` |
| 路径规划 | `GET /api/map/route` | `map-board` |
| 司机列表 | `GET /api/drivers` | `map-board` / `admin-workflow` |
| 司机工单轴 | `GET /api/drivers/:id/work-orders` | `admin-workflow` |
| 车辆同步 | `POST /api/vehicles/ingest` | `integration-adapter` |
| 车辆查询 | `GET /api/vehicles` | `admin-workflow` / `integration-adapter` |
| 推荐派单 | `POST /api/dispatch/recommend` | `dispatch-rule-v1` |
| 确认推荐派单 | `POST /api/dispatch/confirm` | `dispatch-rule-v1` |
| 手动派单 / 改派 / 撤回 | `/api/assignments/*` | `admin-workflow` |
| 预警查询 | `GET /api/alerts` | `logging-observe` / `admin-workflow` |
| 日志查询 | `GET /api/logs` | `logging-observe` |

## 6. 验收标准

- 所有 API 响应包含 `success / data / error / traceId`。
- 所有 API 响应头包含 `X-Trace-Id`。
- 派单、改派、撤回使用事务并写日志。
- 地图点位、车辆、司机、订单查询接口支持 demo_v12 所需字段。
- 前端 UI 不依赖 mock 数组即可渲染主要模块。
- HTML demo 中的中文展示态必须在正式代码中映射到英文枚举。
- 接口契约变化必须同步更新本文档。

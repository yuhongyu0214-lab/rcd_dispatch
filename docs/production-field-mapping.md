# 生产化字段映射表

> **冻结声明**：本文档冻结后，字段变更必须先修改本文档再改代码。任何未经文档更新的字段变更视为违规，Code Review 阶段必须驳回。

版本：v1.0  
冻结日期：2026-07-04  
适用范围：`integration-adapter` 阶段及之后所有与外部平台对接的代码  
关联文档：`docs/demo-v12-api-contract.md`、`prisma/schema.prisma`（data-model 冻结版）

---

## 目录

1. [架构概述](#1-架构概述)
2. [订单字段映射](#2-订单字段映射)
3. [司机字段映射](#3-司机字段映射)
4. [车辆字段映射](#4-车辆字段映射)
5. [地理编码字段映射](#5-地理编码字段映射)
6. [枚举映射表](#6-枚举映射表)
7. [缺失字段处理策略](#7-缺失字段处理策略)
8. [版本兼容](#8-版本兼容)

---

## 1. 架构概述

### 1.1 Adapter 在系统中的位置

```
外部平台 (哈啰/GPS/其他)
       │
       ▼
┌─────────────────┐
│  Adapter Layer  │  ← 本文档覆盖范围
│  (lib/adapters/) │
└────────┬────────┘
         │ 统一 DTO (types.ts)
         ▼
┌─────────────────┐
│  API Route 层    │  (app/api/orders/ingest, app/api/vehicles/ingest)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Prisma / DB    │  (prisma/schema.prisma)
└─────────────────┘
```

### 1.2 现有 Adapter

| Adapter | Source 标识 | 文件位置 | 职责 | 状态 |
|---------|------------|---------|------|------|
| 哈啰订单 | `HALUO_MOCK` | `adapters/haluo/` | 将哈啰订单 JSON 映射为内部 OrderDTO | Mock |
| GPS 车辆定位 | `GPS_MOCK` | `adapters/gps/` | 将 GPS 车载设备位置上报映射为 VehicleLocationDTO | Mock |

### 1.3 核心 DTO（统一中间层）

Adapter 层定义的内部 DTO 位于 `src/lib/adapters/types.ts`，是所有外部平台数据的统一中间表示。各 Adapter 的 mapper 函数负责将外部原始字段转换为这些 DTO。

---

## 2. 订单字段映射

### 2.1 哈啰订单 → OrderDTO

**Mapper 函数**：`mapHaluoOrderToOrderDTO()`（`adapters/haluo/mapper.ts`）

| 序号 | 外部字段 (Haluo) | 外部类型 | 内部字段 (OrderDTO) | 内部类型 | 转换规则 | 必填 | 默认值 |
|------|-----------------|---------|-------------------|---------|---------|------|--------|
| 1 | `order_id` | `string` | `externalOrderId` | `string` | 直接透传 | **是** | — |
| 2 | `order_no` | `string` | `orderNo` | `string` | 直接透传 | **是** | — |
| 3 | `biz_type` | `HaluoOrderBizType` | `type` | `OrderType`（Prisma enum） | 查表转换（见 2.2 节） | **是** | — |
| 4 | — | — | `status` | `OrderStatus`（Prisma enum） | 固定写入 `PENDING` | — | `"PENDING"` |
| 5 | `store_code` | `string` | `storeCode` | `string` | 直接透传 | **是** | — |
| 6 | `store_name` | `string` | `storeName` | `string` | 直接透传 | **是** | — |
| 7 | `car_plate` | `string?` | `licensePlateSnapshot` | `string \| null` | `?? null`（空字符串/undefined → null） | 否 | `null` |
| 8 | `car_model` | `string?` | `vehicleTypeSnapshot` | `string \| null` | `?? null` | 否 | `null` |
| 9 | `pickup_address` | `string` | `pickupAddress` | `string` | 直接透传 | **是** | — |
| 10 | `pickup_lat` + `pickup_lng` | `number?` + `number?` | `pickupCoordinate` | `AdapterCoordinate \| null` | 两者均为 number 时构造 `{lat, lng}`，否则 `null` | 否 | `null` |
| 11 | `return_address` | `string` | `returnAddress` | `string` | 直接透传 | **是** | — |
| 12 | `return_lat` + `return_lng` | `number?` + `number?` | `returnCoordinate` | `AdapterCoordinate \| null` | 同 pickup | 否 | `null` |
| 13 | `appointment_time` | `string`（ISO 8601） | `scheduledAt` | `string` | 直接透传（保留原始 ISO 8601 字符串，入库时由 Prisma 转为 DateTime） | **是** | — |
| 14 | — | — | `channel` | `string` | 固定写入 `"HALUO"` | — | `"HALUO"` |
| 15 | — | — | `source` | `AdapterSource` | 固定写入 `"HALUO_MOCK"`（真实接入后改为 `"HALUO"`） | — | `"HALUO_MOCK"` |

### 2.2 订单业务类型映射（biz_type → OrderType）

| 外部值 (`biz_type`) | 内部枚举 (`OrderType`) | 中文含义 |
|---------------------|----------------------|---------|
| `"store_pickup"` | `STORE_PICKUP` | 门店取车 |
| `"store_return"` | `STORE_RETURN` | 门店还车 |
| `"door_delivery"` | `DOOR_DELIVERY` | 送车上门 |
| `"door_pickup"` | `DOOR_PICKUP` | 上门取车 |

规则：
- 外部值不在映射表中的订单**直接拒绝**，不写入数据库。错误信息格式：`"不支持的订单类型: <biz_type>"`。
- 该映射表为双向映射：`HALUO_TYPE_MAP` 常量定义在 `adapters/haluo/mapper.ts` 中。

### 2.3 订单必填校验规则

以下字段缺失时，该条订单记录应被拒绝并记录行级错误：

| 字段 | 校验规则 | 错误信息模板 |
|------|---------|------------|
| `order_id` | 非空字符串 | `"外部订单ID缺失"` |
| `order_no` | 非空字符串 | `"订单号缺失"` |
| `biz_type` | 必须在 `HALUO_TYPE_MAP` 中存在 | `"不支持的订单类型: {value}"` |
| `store_code` | 非空字符串 | `"门店编码缺失"` |
| `store_name` | 非空字符串 | `"门店名称缺失"` |
| `pickup_address` | 非空字符串 | `"取车地址缺失"` |
| `return_address` | 非空字符串 | `"还车地址缺失"` |
| `appointment_time` | 非空，可解析为合法 DateTime | `"预约时间缺失或格式错误: {value}"` |

### 2.4 OrderDTO → Prisma Order 模型入库映射

Adapter 输出 OrderDTO 后，由 `POST /api/orders/ingest` 路由负责入库。入库时的字段对应关系：

| OrderDTO 字段 | Prisma Order 字段 | 入库转换 |
|--------------|-------------------|---------|
| `externalOrderId` | **不直接入库**（见下方说明） | 可作为 `orderNo` 的候选或写入 metadata |
| `orderNo` | `orderNo` | 直接写入 |
| `type` | `type` | 直接写入（枚举值一致） |
| `status` | `status` | 直接写入（`PENDING`） |
| `storeCode` | **不直接入库** | 通过 `storeCode` 查找 `Store.id` 写入 `storeId` |
| `storeName` | **不直接入库** | 仅用于匹配/校验门店 |
| `licensePlateSnapshot` | `licensePlateSnapshot` | 直接写入 |
| `vehicleTypeSnapshot` | `vehicleTypeSnapshot` | 直接写入 |
| `pickupAddress` | `pickupAddress` | 直接写入 |
| `pickupCoordinate.lat` | `pickupLat` | 直接写入（可为 null） |
| `pickupCoordinate.lng` | `pickupLng` | 直接写入（可为 null） |
| `returnAddress` | `returnAddress` | 直接写入 |
| `returnCoordinate.lat` | `returnLat` | 直接写入（可为 null） |
| `returnCoordinate.lng` | `returnLng` | 直接写入（可为 null） |
| `scheduledAt` | `scheduledAt` | 字符串 → `new Date()` |
| `channel` | `channel` | 直接写入 |
| `source` | **不直接入库** | 写入 `importBatchId` 关联的批次记录或 operation_log 的 metadata |

> **注意**：`externalOrderId` 在当前 Prisma Schema 中没有对应字段。建议策略：以 `orderNo` 为主键标识，`externalOrderId` 写入 `OperationLog.metadataJson` 中用于溯源。若未来需幂等去重，可通过 `orderNo` 唯一约束实现。

---

## 3. 司机字段映射

### 3.1 外部司机字段 → Driver 模型

当前 Adapter 层尚未实现司机数据接入。以下为预留映射规范，供后续 `integration-adapter` 阶段实现。

| 序号 | 外部字段（通用命名） | 外部类型 | Prisma Driver 字段 | 内部类型 | 转换规则 | 必填 | 默认值 |
|------|---------------------|---------|-------------------|---------|---------|------|--------|
| 1 | `driver_id` | `string` | **不直接入库** | — | 写入 operation_log metadata 用于溯源 | **是** | — |
| 2 | `name` | `string` | `name` | `string` | 直接透传 | **是** | — |
| 3 | `phone` | `string` | `phone` | `string`（unique） | 直接透传；入库前校验手机号格式 | **是** | — |
| 4 | `store_code` | `string` | `storeId` | `string`（FK） | 通过 `store_code` 查找 `Store.id` | **是** | — |
| 5 | `status` | `string` | `status` | `DriverStatus` | 查表转换（见第 6 节枚举映射） | 否 | `S1` |
| 6 | `is_active` | `boolean?` | `isActive` | `boolean` | 直接透传 | 否 | `true` |

### 3.2 司机状态映射（预留）

| 外部平台可能值 | 内部枚举 `DriverStatus` | 说明 |
|--------------|----------------------|------|
| `"online_idle"` | `S1` | 门店空闲 |
| `"online_return"` | `S2` | 返程空闲 |
| `"online_busy"` | `S3` | 门店忙碌 |
| `"in_order"` | `S4` | 订单忙碌 |
| `"offline"` | `OFFLINE` | 离线 |
| `"unavailable"` | `UNAVAILABLE` | 暂不可用 |

> 当前 S1-S4 是演示期状态，后续可能合并简化。外部 Adapter 只需关注映射表，不关心内部枚举含义。

### 3.3 司机必填校验

| 字段 | 校验规则 |
|------|---------|
| `driver_id` | 非空字符串 |
| `name` | 非空，长度 1-50 字符 |
| `phone` | 非空，匹配 `/^1[3-9]\d{9}$/` |
| `store_code` | 非空，且对应 Store 记录存在 |

---

## 4. 车辆字段映射

### 4.1 外部车辆字段 → Vehicle 模型

| 序号 | 外部字段（通用命名） | 外部类型 | Prisma Vehicle 字段 | 内部类型 | 转换规则 | 必填 | 默认值 |
|------|---------------------|---------|--------------------|---------|---------|------|--------|
| 1 | `vehicle_id` | `string` | **不直接入库** | — | 写入 operation_log metadata 用于溯源 | **是** | — |
| 2 | `plate_no` / `license_plate` | `string` | `licensePlate` | `string`（unique） | 直接透传；入库前去空格、统一大写 | **是** | — |
| 3 | `vehicle_type` / `model` | `string` | `vehicleType` | `string` | 直接透传 | 否 | `"未知车型"` |
| 4 | `store_code` | `string` | `storeId` | `string`（FK） | 通过 `store_code` 查找 `Store.id` | **是** | — |
| 5 | `status` | `string` | `status` | `VehicleStatus` | 查表转换（见第 6 节枚举映射） | 否 | `AVAILABLE` |
| 6 | `latitude` + `longitude` | `number?` + `number?` | `gpsLat` + `gpsLng` | `Float?` + `Float?` | 两者均为 number 时写入，否则 null | 否 | `null` |
| 7 | `is_active` | `boolean?` | `isActive` | `boolean` | 直接透传 | 否 | `true` |

### 4.2 GPS 车辆位置 → VehicleLocationDTO（现有实现）

**Mapper 函数**：`mapGpsVehicleLocationToDTO()`（`adapters/gps/mapper.ts`）

| 序号 | 外部字段 (GpsVehicleLocationPayload) | 外部类型 | 内部字段 (VehicleLocationDTO) | 内部类型 | 转换规则 | 必填 | 默认值 |
|------|-------------------------------------|---------|------------------------------|---------|---------|------|--------|
| 1 | `vehicle_id` | `string` | `vehicleId` | `string` | 直接透传 | **是** | — |
| 2 | `device_id` | `string` | **不映射** | — | 仅用于日志记录，不进入 DTO | — | — |
| 3 | `plate_no` | `string` | **不映射** | — | 车辆标识由 `vehicleId` 查找，`plate_no` 仅做交叉校验 | — | — |
| 4 | `latitude` | `number` | `coordinate.lat` | `number` | 直接透传 | **是** | — |
| 5 | `longitude` | `number` | `coordinate.lng` | `number` | 直接透传 | **是** | — |
| 6 | `gps_time` | `string`（ISO 8601） | `updatedAt` | `string` | 直接透传 | **是** | — |
| 7 | — | — | `source` | `AdapterSource` | 固定写入 `"GPS_MOCK"`（真实接入后改为 `"GPS"`） | — | `"GPS_MOCK"` |

### 4.3 车辆必填校验

| 字段 | 校验规则 |
|------|---------|
| `plate_no` | 非空，长度 7-8 字符（支持新能源车牌），入库前统一大写去空格 |
| `store_code` | 非空，且对应 Store 记录存在 |
| `latitude` + `longitude` | 若提供则必须同时有效（-90~90 / -180~180 范围校验） |

---

## 5. 地理编码字段映射

### 5.1 地址 → 坐标转换流程

当外部平台订单**仅提供地址、未提供经纬度**时（即 `pickupCoordinate` 或 `returnCoordinate` 为 null），系统需要自行调用地理编码服务将地址转换为坐标。

```
外部订单到达（含 pickup_address / return_address）
              │
              ▼
    ┌─────────────────────┐
    │  Adapter Mapper      │
    │  → OrderDTO          │
    │  (coordinate 可能    │
    │   为 null)           │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │  POST /api/orders/   │
    │  ingest              │
    │                      │
    │  检查 coordinate     │
    │  是否为 null         │
    └─────────┬───────────┘
              │ coordinate == null
              ▼
    ┌─────────────────────┐
    │  lib/geocode.ts      │
    │  geocodeAddress()    │
    │                      │
    │  调用高德地理编码 API │
    │  /v3/geocode/geo     │
    └─────────┬───────────┘
              │ 成功
              ▼
    ┌─────────────────────┐
    │  写入 pickupLat/     │
    │  pickupLng           │
    │  (或 returnLat/      │
    │   returnLng)         │
    └─────────────────────┘
```

### 5.2 地理编码数据流

| 步骤 | 输入 | 处理 | 输出 | 失败策略 |
|------|------|------|------|---------|
| 1 | `pickupAddress: string` | 高德 `/v3/geocode/geo?address=<address>&key=<AMAP_SERVER_KEY>` | `{lat, lng}` 或 error | 重试 1 次（间隔 500ms），仍失败则坐标留 null，记录 `GEOCODE_FAILED` 预警 |
| 2 | `returnAddress: string` | 同上 | `{lat, lng}` 或 error | 同上 |
| 3 | 坐标写入 | `prisma.order.update({ pickupLat, pickupLng })` | 持久化 | 事务回滚，订单标记为入库失败 |

### 5.3 坐标反查（预留）

当外部平台仅提供坐标、未提供可读地址时，调用高德逆地理编码 `/v3/geocode/regeo` 获取地址文本。当前实际业务中未出现此场景，接口保留。

### 5.4 坐标有效性校验

| 字段 | 校验规则 |
|------|---------|
| `latitude` | `-90 <= lat <= 90` |
| `longitude` | `-180 <= lng <= 180` |
| 坐标来源标记 | 外部提供 → `metadata.source = "external"`；系统编码 → `metadata.source = "amap_geocode"` |

---

## 6. 枚举映射表

### 6.1 订单类型映射

| 外部平台 | 外部值 | 内部枚举 `OrderType` | 方向 |
|---------|--------|---------------------|------|
| 哈啰 | `"store_pickup"` | `STORE_PICKUP` | 入 |
| 哈啰 | `"store_return"` | `STORE_RETURN` | 入 |
| 哈啰 | `"door_delivery"` | `DOOR_DELIVERY` | 入 |
| 哈啰 | `"door_pickup"` | `DOOR_PICKUP` | 入 |

### 6.2 订单状态映射

> 外部订单进入系统时，强制写入 `PENDING`，不允许外部指定状态。后续状态流转由系统内部控制。

| 内部枚举 `OrderStatus` | 中文展示 | 外部可见性 | 说明 |
|-----------------------|---------|-----------|------|
| `PENDING` | 待分配 | 内部 | 入库初始状态 |
| `RECOMMENDING` | 推荐中 | 内部 | 推荐引擎计算中 |
| `ASSIGNED` | 已派单 | 可外发 | 调度员已指派司机 |
| `ACCEPTED` | 已接单 | 可外发 | 司机确认接单 |
| `IN_PROGRESS` | 执行中 | 可外发 | 任务进行中 |
| `COMPLETED` | 已完成 | 可外发 | 终态 |
| `RECYCLED` | 已回收 | 内部 | 过渡态，回到 PENDING |
| `CANCELLED` | 已取消 | 可外发 | 终态 |

### 6.3 司机状态映射

| 内部枚举 `DriverStatus` | 中文展示（DriverDTO.statusText） | 是否可派单 | 说明 |
|------------------------|-------------------------------|-----------|------|
| `S1` | 门店空闲 | 是 | 在店，可接新单 |
| `S2` | 返程空闲 | 是 | 返程中，可预约下一单 |
| `S3` | 门店忙碌 | 否 | 在店整理/清洁中 |
| `S4` | 订单忙碌 | 否 | 已接单执行中 |
| `OFFLINE` | 离线 | 否 | GPS 离线或主动下线 |
| `UNAVAILABLE` | 暂不可用 | 否 | 请假/维修等 |

### 6.4 车辆状态映射

| 内部枚举 `VehicleStatus` | 前端展示 (VehicleDTO.status) | 中文展示 | 是否可派单 | 说明 |
|-------------------------|----------------------------|---------|-----------|------|
| `AVAILABLE` | `DISPATCHABLE` | 可派单 | 是 | 空闲可用 |
| `PRE_ASSIGNED` | （内部） | 预分配 | 否 | 已被推荐但未确认 |
| `IN_USE` | `IN_ORDER` | 订单中 | 否 | 正在执行订单 |
| `UNAVAILABLE` | `UNAVAILABLE` | 暂不可用 | 否 | 维修/保养/清洁/补能 |

> 前端展示的 `CLEANING`、`ENERGY_REFILL`、`GPS_OFFLINE` 等状态属于业务进度标记（progress），存储在 `VehicleDTO.statusText` 中，不等同于数据库枚举值。

### 6.5 派单类型映射

| 内部枚举 `AssignmentType` | 中文 | 触发条件 |
|--------------------------|------|---------|
| `MANUAL_ASSIGN` | 手动派单 | 调度员在订单池/地图上手动指派 |
| `RECOMMEND_ASSIGN` | 推荐派单 | `POST /api/dispatch/confirm` 确认推荐结果 |
| `REASSIGN` | 改派 | `POST /api/assignments/reassign` |

### 6.6 派单状态映射

| 内部枚举 `AssignmentStatus` | 中文 | 说明 |
|----------------------------|------|------|
| `ACTIVE` | 生效中 | 已派单，等待司机响应 |
| `ACCEPTED` | 已接单 | 司机确认接单 |
| `WITHDRAWN` | 已撤回 | 调度员撤回派单 |
| `RECYCLED` | 已回收 | 订单回收后作废 |
| `COMPLETED` | 已完成 | 订单完成 |
| `CANCELLED` | 已取消 | 订单取消 |

---

## 7. 缺失字段处理策略

### 7.1 总原则

| 优先级 | 策略 | 适用场景 |
|--------|------|---------|
| P0 | **拒绝入库** | 必填字段缺失，无法补全 |
| P1 | **写入默认值** | 非必填字段缺失，有合理默认值 |
| P2 | **标记预警** | 重要但非阻断字段缺失，入库后人工处理 |
| P3 | **留空（null）** | 可选增强字段，不影响核心流程 |

### 7.2 按字段分类的默认值与降级规则

#### 订单字段

| 字段 | 缺失时的行为 | 降级策略 |
|------|------------|---------|
| `order_id` | **拒绝入库**（P0） | — |
| `order_no` | **拒绝入库**（P0） | — |
| `biz_type` | **拒绝入库**（P0） | — |
| `store_code` | **拒绝入库**（P0） | 不可通过 store_name 反向查找，因为 store_name 可能重复 |
| `store_name` | **拒绝入库**（P0） | — |
| `car_plate` | 写入 `null`（P3） | 不影响派单，调度员可在订单详情中补录 |
| `car_model` | 写入 `null`（P3） | 同上 |
| `pickup_address` | **拒绝入库**（P0） | — |
| `return_address` | **拒绝入库**（P0） | — |
| `pickup_lat` / `pickup_lng` | 坐标留 `null`，异步调用高德地理编码补全（P2） | 补全失败：标记 `GEOCODE_FAILED` 预警，订单仍可入库但地图上不显示定位点 |
| `return_lat` / `return_lng` | 同上（P2） | 同上 |
| `appointment_time` | **拒绝入库**（P0） | — |

#### 车辆字段

| 字段 | 缺失时的行为 | 降级策略 |
|------|------------|---------|
| `vehicle_id` | **拒绝入库**（P0） | — |
| `plate_no` | **拒绝入库**（P0） | — |
| `vehicle_type` | 写入 `"未知车型"`（P1） | — |
| `store_code` | **拒绝入库**（P0） | — |
| `status` | 写入 `AVAILABLE`（P1） | — |
| `latitude` / `longitude` | 坐标留 `null`（P3） | GPS 状态标记为 `OFFLINE` |
| `gps_time` | 坐标一并置 `null`（P2） | 时间缺失意味着坐标可信度低，视为 GPS 离线 |

#### 司机字段（预留）

| 字段 | 缺失时的行为 | 降级策略 |
|------|------------|---------|
| `driver_id` | **拒绝入库**（P0） | — |
| `name` | **拒绝入库**（P0） | — |
| `phone` | **拒绝入库**（P0） | — |
| `store_code` | **拒绝入库**（P0） | — |
| `status` | 写入 `S1`（P1） | — |

### 7.3 批量导入中的部分失败处理

- 批量导入时，单条记录失败不应阻断批次中其他有效记录。
- 返回结果中逐行标注 `rowErrors`（见 `POST /api/orders/ingest` 的 `OrderIngestResult` 契约）。
- 全部记录失败的批次，`importBatchId` 仍然生成，`successCount = 0`，便于日志追踪。

### 7.4 数据类型不兼容时的处理

| 场景 | 处理 |
|------|------|
| 期望 `number`，收到 `string`（如 `"31.1942"`） | 尝试 `parseFloat()`，若 `NaN` 则视为缺失，应用该字段的缺失策略 |
| 期望 `string`，收到 `number` | 调用 `.toString()` 转换，记录 `logger.warn` |
| 期望 ISO 8601，收到其他日期格式 | 尝试 `new Date()` 解析，若 `Invalid Date` 则 **拒绝入库** |
| 期望枚举值，收到未知字符串 | **拒绝入库**，不在映射表中的枚举值不可猜测 |
| 期望 `boolean`，收到 `0`/`1` 或 `"true"`/`"false"` | `0`/`"false"` → `false`；`1`/`"true"` → `true`；其他视为缺失 |

---

## 8. 版本兼容

### 8.1 Adapter 版本号规则

每个 Adapter 目录在 `types.ts` 中声明版本号常量：

```ts
/** Adapter 版本号，用于字段变更追溯 */
export const ADAPTER_VERSION = "1.0.0";
```

版本号格式：`MAJOR.MINOR.PATCH`（语义化版本）

| 变更类型 | 版本号变化 | 示例 |
|---------|-----------|------|
| 新增可选字段 | PATCH +1 | `1.0.0 → 1.0.1` |
| 新增必填字段 | MINOR +1 | `1.0.1 → 1.1.0` |
| 删除字段 / 修改字段名 / 修改字段类型 | MAJOR +1 | `1.1.0 → 2.0.0` |
| 新增整个 Adapter | MINOR +1 | — |

### 8.2 字段变更时的兼容策略

#### 原则：向后兼容优先

- **新增可选字段**：老版本外部数据缺少该字段时，使用默认值（见第 7 节），不报错。
- **新增必填字段**：新版本 Adapter 应同时发布字段校验规则文档，外部平台需在约定窗口期内适配。
- **删除字段**：禁止直接删除。应先标记 `@deprecated`，保留一个 MINOR 版本周期后再删除。
- **修改字段名**：等同于删除旧字段 + 新增新字段，走 MAJOR 版本升级，并保留旧字段名到当前 MAJOR 版本结束。
- **修改枚举值**：旧值保留在映射表中标记 `@deprecated`，新值同步加入，一个 MINOR 版本后再移除旧值。

#### 兼容矩阵

```
Adapter v1.0.0 ← 兼容 → 外部平台协议 2026-06 版（当前）
Adapter v1.0.1 ← 兼容 → 协议新增可选字段
Adapter v1.1.0 ← 兼容 → 协议新增必填字段（外部平台需升级）
Adapter v2.0.0 ← 不兼容 → 协议重大变更（字段删除/重命名）
```

### 8.3 变更流程

1. 外部平台发版通知 → 评估字段变更影响范围
2. **先更新本文档**——新增/修改映射条目，标注版本号
3. 更新 Adapter `types.ts` 中的 `ADAPTER_VERSION`
4. 更新 mapper 函数和校验规则
5. 更新单元测试（`adapters.test.ts`）
6. Code Review 确认文档与代码一致
7. 合并后通知对接方新版本号

### 8.4 Adapter 注册表

`adapters/index.ts` 维护所有已注册的 Adapter：

```ts
// 新增 Adapter 时在此注册
export * as gps from "./gps";
export * as haluo from "./haluo";
// 未来: export * as companyA from "./company-a";
```

每个 Adapter 必须导出的契约：
- `types.ts`：外部平台字段类型定义 + `ADAPTER_VERSION`
- `mapper.ts`：字段映射函数（外部 → 内部 DTO）
- `index.ts`：对外暴露的入口函数（fetch / push）+ 重新导出 mapper

---

## 附录 A：现有 Mapper 函数签名速查

| 函数 | 文件 | 签名 |
|------|------|------|
| `mapHaluoOrderToOrderDTO` | `adapters/haluo/mapper.ts` | `(payload: HaluoOrderPayload) => OrderDTO` |
| `fetchOrders` | `adapters/haluo/index.ts` | `() => Promise<OrderDTO[]>` |
| `mapGpsVehicleLocationToDTO` | `adapters/gps/mapper.ts` | `(payload: GpsVehicleLocationPayload) => VehicleLocationDTO` |
| `fetchVehicleLocation` | `adapters/gps/index.ts` | `(vehicleId: string) => Promise<{ lat: number; lng: number; updatedAt: string }>` |

## 附录 B：相关文件索引

| 文件 | 用途 |
|------|------|
| `feature-admin-workflow/prisma/schema.prisma` | 数据模型定义（枚举 + 表结构） |
| `feature-admin-workflow/src/lib/adapters/types.ts` | 内部 DTO 类型定义 |
| `feature-admin-workflow/src/lib/adapters/haluo/types.ts` | 哈啰外部字段类型 |
| `feature-admin-workflow/src/lib/adapters/haluo/mapper.ts` | 哈啰字段映射实现 |
| `feature-admin-workflow/src/lib/adapters/gps/types.ts` | GPS 外部字段类型 |
| `feature-admin-workflow/src/lib/adapters/gps/mapper.ts` | GPS 字段映射实现 |
| `feature-admin-workflow/src/lib/adapters/index.ts` | Adapter 注册表 |
| `feature-admin-workflow/src/lib/adapters/adapters.test.ts` | Adapter 单元测试 |
| `docs/demo-v12-api-contract.md` | API DTO 契约定义 |

## 附录 C：文档修订记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2026-07-04 | v1.0 | 初始冻结版本，覆盖哈啰订单 + GPS 车辆位置映射、枚举映射表、缺失字段策略、版本兼容规则 | Claude Code |

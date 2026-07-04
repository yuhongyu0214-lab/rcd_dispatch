# 司机位置上报协议

版本：v1.0（冻结）
日期：2026-07-04
适用端：微信小程序司机端 → 调度系统后端
存储目标：Tair/Redis（最新位置）+ RDS/PostgreSQL（历史轨迹采样）

---

## 1. 上报接口：POST /api/driver/location

### 1.1 请求

#### HTTP

```
POST /api/driver/location
Content-Type: application/json
Authorization: Bearer <driver_token>
```

#### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DriverLocationReport",
  "type": "object",
  "required": ["driverId", "lat", "lng", "timestamp"],
  "properties": {
    "driverId": {
      "type": "string",
      "minLength": 1,
      "description": "司机 ID，对应 Driver.id"
    },
    "lat": {
      "type": "number",
      "minimum": 18.0,
      "maximum": 54.0,
      "description": "纬度（WGS84/GCJ02），范围 18-54（中国境内）"
    },
    "lng": {
      "type": "number",
      "minimum": 73.0,
      "maximum": 136.0,
      "description": "经度（WGS84/GCJ02），范围 73-136（中国境内）"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "客户端采集时间，ISO 8601 格式。服务器以此时刻为准，不信任服务端接收时间"
    },
    "accuracy": {
      "type": "number",
      "minimum": 0,
      "description": "水平定位精度（米），GPS < 20m，基站 < 100m，WiFi 10-50m"
    },
    "speed": {
      "type": "number",
      "minimum": 0,
      "description": "瞬时速度（km/h），微信小程序 wx.getLocation 不直接提供，可从连续点位推算"
    },
    "altitude": {
      "type": "number",
      "description": "海拔高度（米），部分设备不提供，缺省 null"
    },
    "direction": {
      "type": "number",
      "minimum": 0,
      "maximum": 360,
      "description": "行进方向角度（0-360），0 为正北，顺时针"
    },
    "provider": {
      "type": "string",
      "enum": ["gps", "network", "wifi", "unknown"],
      "default": "unknown",
      "description": "定位来源：gps（卫星）、network（基站）、wifi、unknown"
    },
    "orderId": {
      "type": "string",
      "description": "可选，当前执行中的订单 ID，用于关联轨迹与订单"
    },
    "batteryLevel": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "设备电量百分比，用于分析上报中断是否因低电量"
    },
    "networkType": {
      "type": "string",
      "enum": ["wifi", "4g", "5g", "3g", "2g", "none", "unknown"],
      "description": "网络类型，辅助分析定位精度和上传延迟"
    }
  }
}
```

#### 请求示例

```json
{
  "driverId": "clx7a8b9c0001xyzabc",
  "lat": 31.2304,
  "lng": 121.4737,
  "timestamp": "2026-07-04T10:30:15+08:00",
  "accuracy": 12.5,
  "speed": 45.2,
  "altitude": 4.8,
  "direction": 270.0,
  "provider": "gps",
  "orderId": "clx7a8b9c0002xyzdef",
  "batteryLevel": 72,
  "networkType": "4g"
}
```

### 1.2 响应

#### 成功（200）

```json
{
  "success": true,
  "data": {
    "driverId": "clx7a8b9c0001xyzabc",
    "lat": 31.2304,
    "lng": 121.4737,
    "timestamp": "2026-07-04T10:30:15+08:00",
    "persisted": true,
    "nextReportIntervalMs": 10000,
    "serverTime": "2026-07-04T10:30:15.234+08:00"
  },
  "error": null,
  "traceId": "3f2a1b8c-..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `persisted` | boolean | true=Tair+RDS 双写成功；false=仅写入一侧或未写 |
| `nextReportIntervalMs` | number | 服务端建议的下次上报间隔（毫秒），见第 2 节频率策略 |
| `serverTime` | string | 服务端接收时间，供客户端校时 |

`nextReportIntervalMs` 由服务端根据司机当前状态动态计算：
- 执行中（`IN_PROGRESS`）：10000（10 秒）
- 其他状态：30000（30 秒）

#### 客户端错误（400）

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_PARAM",
    "message": "坐标不合法：纬度 99.0 超出中国境内范围 [18, 54]",
    "details": {
      "field": "lat",
      "value": 99.0,
      "constraint": "range [18.0, 54.0]"
    }
  },
  "traceId": "3f2a1b8c-..."
}
```

#### 鉴权失败（401/404）

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "DRIVER_NOT_FOUND",
    "message": "司机不存在或已停用"
  },
  "traceId": "3f2a1b8c-..."
}
```

#### 频率限制（429）

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "上报频率过高，请降速至 5 秒以上",
    "details": {
      "driverId": "clx7a8b9c0001xyzabc",
      "retryAfterMs": 5000
    }
  },
  "traceId": "3f2a1b8c-..."
}
```

### 1.3 错误码汇总

| HTTP | error.code | 含义 |
|------|------------|------|
| 400 | `INVALID_PARAM` | 参数不合法（含坐标越界、格式错误） |
| 400 | `MALFORMED_JSON` | 请求体非合法 JSON |
| 400 | `MISSING_FIELD` | 缺少必填字段 |
| 401 | `UNAUTHORIZED` | 未携带有效 token |
| 404 | `DRIVER_NOT_FOUND` | 司机不存在或 isActive=false |
| 429 | `RATE_LIMITED` | 上报频率超过限制 |
| 500 | `INTERNAL_ERROR` | 服务端内部错误 |

---

## 2. 上报频率策略

### 2.1 客户端策略

| 司机状态 | 上报间隔 | 说明 |
|----------|----------|------|
| 执行中（S4 / IN_PROGRESS） | 5-15 秒 | 需实时跟踪轨迹，用于 ETA 计算和地图展示 |
| 非执行中（S1/S2/S3/OFFLINE） | 30-60 秒 | 仅需保持心跳，维持在线状态 |
| 状态变更事件 | 立即上报 | 接单、开始执行、完成订单等状态变更时立即上报一次位置 |
| 前台活跃 | 按上述间隔 | 小程序在前台时按标准间隔上报 |
| 后台/锁屏 | 尽力而为 | 微信限制后台定位时长和精度，详见 2.2 |

### 2.2 微信小程序后台定位能力

微信小程序 `wx.startLocationUpdateBackground` 支持后台定位，但存在以下限制：

- **后台定位时长**：iOS 约 30 分钟，Android 取决于系统省电策略
- **精度降级**：后台定位精度可能自动降级（GPS → 基站），accuracy 值增大
- **频率限制**：微信平台对后台定位回调频率有限制，实际间隔可能大于客户端设置值
- **用户授权**：需要用户授权 `scope.userLocationBackground`，且每次进入后台会向用户提示"小程序正在使用定位"
- **建议**：客户端在 `app.json` 中声明 `"requiredBackgroundModes": ["location"]`，并在进入后台时切换到最低可用频率
- **系统杀死**：小程序进入后台超过 5 分钟后可能被系统挂起，此时定位回调停止

### 2.3 服务端动态调速

服务端在每次上报的响应中返回 `nextReportIntervalMs`，客户端应以该值为准：

- 司机开始执行订单：服务端响应间隔降至 10 秒
- 司机完成订单后：服务端响应间隔升至 30 秒
- 司机离线超过 180 秒：服务端响应间隔升至 60 秒（节省流量和电量）

客户端逻辑：取 `max(服务端建议间隔, 本地最小间隔5秒)` 作为实际间隔。

### 2.4 心跳超时与重试

- 单次上报失败（网络超时/5xx）：客户端静默重试，最多 2 次，间隔 2 秒
- 连续 3 次上报失败：记录本地日志，降级为 60 秒间隔重试
- 网络恢复（`wx.onNetworkStatusChange`）：立即触发一次位置上报

---

## 3. 坐标字段规范

### 3.1 字段定义

| 字段 | 类型 | 单位 | 必填 | 说明 |
|------|------|------|------|------|
| `lat` | number | 度 | 是 | 纬度，WGS84 或 GCJ02 |
| `lng` | number | 度 | 是 | 经度，WGS84 或 GCJ02 |
| `timestamp` | string(ISO 8601) | - | 是 | 客户端采集时间戳 |
| `accuracy` | number | 米 | 否 | 水平精度 |
| `speed` | number | km/h | 否 | 瞬时速度 |
| `altitude` | number | 米 | 否 | 海拔 |
| `direction` | number | 度(0-360) | 否 | 行进方向 |
| `provider` | enum | - | 否 | 定位来源 |

### 3.2 坐标系说明

- 微信小程序 `wx.getLocation` 默认返回 **GCJ02** 坐标系（中国国测局坐标系）
- 高德地图 JS API 使用 GCJ02，服务端路径规划 API 也接受 GCJ02
- V1 阶段统一以 GCJ02 存储和计算，不做坐标系转换
- 后续对接外部平台时在 `integration-adapter` 阶段处理 WGS84 ↔ GCJ02 转换

### 3.3 精度分级

| accuracy 范围 | 定位质量 | 是否可用于 ETA 计算 |
|---------------|----------|---------------------|
| 0 - 20m | 优秀（GPS 锁定） | 是 |
| 20 - 50m | 良好（WiFi/GPS 辅助） | 是 |
| 50 - 100m | 一般（基站） | 是（误差容忍） |
| > 100m | 差（仅基站粗略定位） | 否，标记 `accuracy_poor` |
| null | 未知 | 是（默认认为可用） |

### 3.4 漂移过滤（客户端侧）

客户端在采集到新位置后，建议进行简单漂移过滤：

- 如果 `accuracy > 100m` 且上次精度 < 20m：丢弃本次，沿用上次位置
- 如果两次采集间隔 < 2 秒且距离 > 500m（速度 > 900km/h）：视为异常漂移，丢弃
- 如果 `speed < 1 km/h` 且连续 3 次位置变化 < accuracy：视为静止，降低上报频率到 30 秒

---

## 4. 数据流向

### 4.1 整体架构

```
微信小程序                    Next.js API                  Tair/Redis               RDS/PostgreSQL
    │                            │                            │                          │
    │  POST /api/driver/location │                            │                          │
    │ ─────────────────────────► │                            │                          │
    │                            │                            │                          │
    │                            │  1. 鉴权 (JWT/Token)       │                          │
    │                            │  2. 参数校验 (坐标范围)      │                          │
    │                            │  3. 频率限制 (SlidingWindow) │                          │
    │                            │                            │                          │
    │                            │  HSET driver:last_location │                          │
    │                            │ ─────────────────────────► │                          │
    │                            │  {driverId}                │                          │
    │                            │  lat/lng/timestamp/...     │                          │
    │                            │                            │                          │
    │                            │  EXPIRE 300                 │                          │
    │                            │ ─────────────────────────► │                          │
    │                            │  (TTL 5 分钟)               │                          │
    │                            │                            │                          │
    │                            │  INSERT driver_location_logs│                          │
    │                            │ ──────────────────────────────────────────────────►  │
    │                            │  (采样写入，非每条上报)        │                          │
    │                            │                            │                          │
    │  200 OK + nextReportInterval│                            │                          │
    │ ◄───────────────────────── │                            │                          │
```

### 4.2 写入规则

#### Tair/Redis — 最新位置（全量写入）

- **每次上报**均写入 Redis Hash，Key 格式见第 5 节
- 写入后设置 TTL（EXPIRE），确保离线司机数据自动过期
- 写入操作异步完成，不阻塞 API 响应
- 写入失败**不**返回 500，仅记录 `logger.error`，`persisted` 标记为 `false`

#### RDS/PostgreSQL — 历史采样（降频写入）

- **非每条上报都写入** RDS，采用采样策略减少写入压力：
  - 司机执行中（S4）：每 **30 秒**写入一条（约每 3 次上报写 1 次）
  - 司机非执行中：每 **120 秒**写入一条
  - 状态变更时：**立即写入**一条（无论距上次采样多久）
  - 距离上次写入位置 > 500m：**立即写入**一条（空间采样）
- 写入失败重试 1 次，仍失败则记录 `logger.error`
- 采样逻辑维护在 API 内：对比上次写入时间戳和距离，决定是否写入 RDS

### 4.3 扩展性预留

Tair/Redis 写入封装为 `lib/location-store.ts` 中的接口，便于后续切换缓存实现（如阿里云 Tair、自建 Redis、ElastiCache）：

```ts
interface LocationCache {
  setLatest(driverId: string, data: DriverLocationData, ttlSeconds: number): Promise<void>;
  getLatest(driverId: string): Promise<DriverLocationData | null>;
  deleteLatest(driverId: string): Promise<void>;
}
```

RDS 写入封装为独立函数 `insertLocationSample()`，支持批量写入优化。

---

## 5. Tair/Redis Key 设计

### 5.1 Key 格式

```
driver:last_location:{driverId}
```

示例：`driver:last_location:clx7a8b9c0001xyzabc`

### 5.2 数据结构（Hash）

| Field | 类型 | 说明 |
|-------|------|------|
| `driver_id` | string | 司机 ID |
| `lat` | string(parseFloat) | 纬度 |
| `lng` | string(parseFloat) | 经度 |
| `timestamp` | string(ISO 8601) | 客户端采集时间 |
| `server_time` | string(ISO 8601) | 服务端接收时间 |
| `accuracy` | string(parseFloat) | 水平精度（米） |
| `speed` | string(parseFloat) | 瞬时速度（km/h） |
| `direction` | string(parseFloat) | 行进方向角度 |
| `provider` | string | 定位来源 |
| `order_id` | string | 当前执行订单 ID（可为空） |
| `status` | string | 司机状态枚举值（S1/S2/S3/S4/OFFLINE/UNAVAILABLE） |
| `network_type` | string | 网络类型 |
| `battery_level` | string(parseInt) | 电量百分比 |

### 5.3 TTL 策略

| 条件 | TTL | 说明 |
|------|-----|------|
| 正常上报 | 300 秒（5 分钟） | 每次 HSET 后刷新 EXPIRE |
| 离线司机 | 不设置，依靠自然过期 | 司机 OFFLINE 时不主动删除，TTL 到期自动移除 |
| 禁用司机 | 立即 DEL | 司机 `isActive=false` 时服务端主动删除 Key |

TTL 的设计逻辑：如果司机超过 5 分钟没有上报，该司机的 Redis 缓存自动失效，地图看板查询时返回 `gpsStatus: "OFFLINE"`。

### 5.4 Redis 操作（原子性）

```redis
# 写入最新位置
HSET driver:last_location:{driverId} \
  driver_id "{driverId}" \
  lat "31.2304" \
  lng "121.4737" \
  timestamp "2026-07-04T10:30:15+08:00" \
  server_time "2026-07-04T10:30:15.234+08:00" \
  accuracy "12.5" \
  speed "45.2" \
  direction "270.0" \
  provider "gps" \
  order_id "clx7a8b9c0002xyzdef" \
  status "S4" \
  network_type "4g" \
  battery_level "72"

# 刷新 TTL
EXPIRE driver:last_location:{driverId} 300

# 查询司机最新位置
HGETALL driver:last_location:{driverId}

# 批量查询（Pipeline）
# 用于地图看板加载所有司机位置
```

---

## 6. RDS 位置采样表设计

### 6.1 表结构（供 data-model 阶段使用）

```sql
CREATE TABLE driver_location_logs (
  id            BIGSERIAL      PRIMARY KEY,
  driver_id     TEXT           NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  accuracy      DOUBLE PRECISION,          -- 水平精度（米）
  speed         DOUBLE PRECISION,          -- 瞬时速度（km/h）
  altitude      DOUBLE PRECISION,          -- 海拔（米）
  direction     DOUBLE PRECISION,          -- 行进方向角度（0-360）
  provider      TEXT           DEFAULT 'unknown',  -- gps/network/wifi/unknown
  recorded_at   TIMESTAMPTZ    NOT NULL,   -- 客户端采集时间（timestamp 字段值）
  server_time   TIMESTAMPTZ    NOT NULL DEFAULT NOW(), -- 服务端接收时间
  order_id      TEXT,                      -- 关联订单 ID（可为空）
  battery_level INTEGER,                   -- 电量百分比（0-100）
  network_type  TEXT,                      -- wifi/4g/5g/3g/2g/none/unknown
  trace_id      TEXT           NOT NULL,   -- 链路追踪 ID
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_dl_driver_recorded ON driver_location_logs (driver_id, recorded_at DESC);
CREATE INDEX idx_dl_order_recorded  ON driver_location_logs (order_id, recorded_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX idx_dl_recorded_at     ON driver_location_logs (recorded_at DESC);
CREATE INDEX idx_dl_trace_id        ON driver_location_logs (trace_id);

-- 分区建议（数据量大时）
-- 按月份 RANGE 分区：PARTITION BY RANGE (recorded_at);
```

### 6.2 Prisma Schema（供参考，实际由 data-model 阶段维护）

```prisma
model DriverLocationLog {
  id           BigInt    @id @default(autoincrement())
  driverId     String
  lat          Float
  lng          Float
  accuracy     Float?
  speed        Float?
  altitude     Float?
  direction    Float?
  provider     String    @default("unknown")
  recordedAt   DateTime  /// 客户端采集时间
  serverTime   DateTime  @default(now()) /// 服务端接收时间
  orderId      String?
  batteryLevel Int?
  networkType  String?
  traceId      String
  createdAt    DateTime  @default(now())

  @@index([driverId, recordedAt(sort: Desc)])
  @@index([orderId, recordedAt(sort: Desc)])
  @@index([recordedAt(sort: Desc)])
  @@index([traceId])
}
```

### 6.3 采样写入策略

写入 `driver_location_logs` 的条件（满足任一即写入）：

1. 距该司机上次写入时间 >= **30 秒**（执行中）或 >= **120 秒**（非执行中）
2. 与上次写入位置直线距离 >= **500 米**
3. 司机状态发生变更（与上次写入时的 status 不同）
4. `accuracy` 从不可用（> 100m）变为可用（≤ 20m），或反之

采样状态维护在内存中（每个 API 实例独立），不做跨实例同步——由于上报本身通过负载均衡分发到不同实例，偶尔多写几条采样数据是可接受的。

### 6.4 数据清理策略

- 保留周期：**90 天**
- 清理任务：每日凌晨 3:00 执行 `DELETE FROM driver_location_logs WHERE created_at < NOW() - INTERVAL '90 days'`
- 归档策略（V2）：超 90 天数据可转存至对象存储（OSS）或冷存储

---

## 7. 离线判定规则

### 7.1 判定逻辑

离线判定在**查询侧**（地图看板、司机列表 API）执行，不在上报侧：

```
IF Redis Key driver:last_location:{driverId} 不存在 THEN
  → gpsStatus = "OFFLINE"
ELSE IF (NOW() - server_time) > 180 秒 THEN
  → gpsStatus = "OFFLINE"
ELSE IF (NOW() - server_time) > 90 秒 THEN
  → gpsStatus = "WEAK"（弱信号，仍在线但需关注）
ELSE
  → gpsStatus = "ONLINE"
```

### 7.2 参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| 弱信号阈值 | 90 秒 | 超过此值标记 `WEAK`，前端显示黄色信号 |
| 离线阈值 | 180 秒 | 超过此值标记 `OFFLINE`，前端显示灰色信号，调度时过滤 |
| Redis TTL | 300 秒 | 超过此值 Key 被 Redis 自动删除 |

### 7.3 离线恢复

司机从离线恢复到在线时：
- 不需要特殊操作，下一次上报自动 HSET + EXPIRE，Redis Key 恢复
- 日志记录：`driver_online_restored { driverId, offlineDuration }`
- 预警解除：如果该司机有活跃的 GPS_OFFLINE 告警，自动清除

### 7.4 离线对调度的影响

- 离线司机不参与推荐派单（`dispatchable: false`）
- 正在执行订单的司机离线：生成 `GPS_OFFLINE` 告警，但不自动取消订单
- 司机主动标记 OFFLINE（状态变更）：服务端主动 DEL Redis Key，立即从地图移除

---

## 8. 错误处理与降级策略

### 8.1 客户端侧

#### 定位失败

| 场景 | 微信 API 表现 | 降级策略 |
|------|-------------|----------|
| 用户拒绝定位权限 | `fail: auth deny` | 引导用户前往设置页开启定位权限，无法上报位置 |
| GPS 信号弱（室内/隧道） | `accuracy > 65m` 或无 GPS | 降级使用基站/WiFi 定位，上报时 `provider: "network"`，accuracy 增大 |
| 系统定位服务关闭 | `fail: system location disabled` | 提示用户开启系统定位，同时尝试 `wx.getLocation({ type: 'gcj02' })` |
| 定位超时（> 10 秒无回调） | 无回调 | 取消本次上报，等待下次定时触发 |

#### 网络超时

| 场景 | 策略 |
|------|------|
| 单次请求超时（> 10 秒） | 取消请求，记录本地日志，等待下次上报周期 |
| 请求失败（非 2xx） | 静默重试最多 2 次，间隔 2 秒 |
| 连续 3 次失败 | 进入降级模式，上报间隔延长到 60 秒 |
| 网络恢复（`wx.onNetworkStatusChange`） | 退出降级模式，立即触发一次上报 |

#### 低电量保护

- 电量 < 20%：上报间隔自动延长到 30 秒（执行中）或 60 秒（非执行中）
- 电量 < 5%：停止上报，记录本地日志

### 8.2 服务端侧

#### 单点故障降级

| 组件 | 故障影响 | 降级策略 |
|------|---------|----------|
| Redis 不可用 | 最新位置无法写入/查询 | 上报接口仍返回成功（`persisted: false`），日志告警；地图看板回退到 RDS 最近一条采样 |
| RDS 不可用 | 历史轨迹无法写入 | 上报接口仍返回成功，日志告警；地图看板无历史轨迹 |
| 高德 API 故障 | 不影响位置上报 | 位置上报不依赖高德 API，仅 ETA/路径规划受影响 |

#### 流量突刺保护

- 单司机频率限制：**最低 5 秒间隔**（滑动窗口），超频返回 429
- 全局限流：单实例 QPS > 5000 时启用降级（丢弃非执行中司机的位置上报，仅保留执行中司机）

---

## 9. 安全校验

### 9.1 坐标合法性

服务端校验规则（按优先级）：

```
1. lat 必须是有限数字，范围 [18.0, 54.0]（中国领土纬度范围）
2. lng 必须是有限数字，范围 [73.0, 136.0]（中国领土经度范围）
3. lat 和 lng 不能同时为 0（手机默认值）
4. accuracy 如提供，必须 >= 0
5. speed 如提供，必须 >= 0 且 < 300（km/h，超过 300 视为异常）
6. timestamp 不能晚于服务端时间 + 300 秒（未来时间容忍 5 分钟时钟偏差）
7. timestamp 不能早于服务端时间 - 86400 秒（不接受超过 24 小时前的定位数据）
```

不合法坐标的处理：返回 400 + `INVALID_PARAM`，记录 `logger.warn`。

### 9.2 频率限制（Rate Limiting）

采用滑动窗口算法：

| 粒度 | 限制 | 说明 |
|------|------|------|
| 单司机 | 1 次 / 5 秒 | 任何司机两次上报间隔不低于 5 秒 |
| 单 IP | 100 次 / 秒 | 防刷 |
| 全局 | 5000 QPS / 实例 | 保护后端 |

实现方式：
- 使用 Redis `INCR` + `EXPIRE` 实现分布式滑动窗口
- Key 格式：`rate:driver_loc:{driverId}`（单司机）、`rate:driver_loc:ip:{ip}`（单 IP）
- 超限返回 429 + `RATE_LIMITED`，含 `retryAfterMs`

### 9.3 身份鉴权

司机端 API 鉴权链：

```
1. 提取 Authorization Header → Bearer <token>
2. 验证 JWT（签名 + 过期时间），从 payload 提取 driverId
3. 校验 payload.driverId === body.driverId（防止冒充）
4. 查询数据库确认 driver.isActive === true
5. 确认 driver.status !== "UNAVAILABLE"（停用司机无法上报）
```

V1 阶段：使用简单的 `x-driver-token` Header + 数据库比对（非 JWT），driver-workflow 阶段升级为 JWT。

### 9.4 数据完整性

- 请求体大小限制：**最大 2KB**（单个位置上报数据量小，限制防止恶意大包）
- Content-Type 必须为 `application/json`
- 所有入参数字字段使用 `parseCoordinate()`（`Number(value)` + `isFinite` 校验），防注入

### 9.5 日志与审计

每次位置上报记录以下审计信息：

```ts
logger.info("driver_location_reported", {
  traceId,
  driverId,
  lat,
  lng,
  accuracy,
  speed,
  provider,
  orderId,
  ip: request.headers.get("x-forwarded-for") || "unknown",
  userAgent: request.headers.get("user-agent") || "unknown",
  persisted: boolean,
  redisWritten: boolean,
  rdsWritten: boolean,
  processingMs: number
});
```

---

## 附录 A：完整请求-响应示例

### A.1 正常上报（执行中司机）

请求：
```json
{
  "driverId": "clx7a8b9c0001xyzabc",
  "lat": 31.2304,
  "lng": 121.4737,
  "timestamp": "2026-07-04T10:30:15+08:00",
  "accuracy": 12.5,
  "speed": 45.2,
  "altitude": 4.8,
  "direction": 270,
  "provider": "gps",
  "orderId": "clx7a8b9c0002xyzdef",
  "batteryLevel": 72,
  "networkType": "4g"
}
```

响应：
```json
{
  "success": true,
  "data": {
    "driverId": "clx7a8b9c0001xyzabc",
    "lat": 31.2304,
    "lng": 121.4737,
    "timestamp": "2026-07-04T10:30:15+08:00",
    "persisted": true,
    "nextReportIntervalMs": 10000,
    "serverTime": "2026-07-04T10:30:15.234+08:00"
  },
  "error": null,
  "traceId": "3f2a1b8c-9d4e-4f1a-8b2c-6e5d4f3a2b1c"
}
```

### A.2 坐标越界

请求：
```json
{
  "driverId": "clx7a8b9c0001xyzabc",
  "lat": 99.9,
  "lng": 121.4737,
  "timestamp": "2026-07-04T10:30:15+08:00"
}
```

响应：
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_PARAM",
    "message": "坐标不合法：纬度 99.9 超出中国境内范围 [18.0, 54.0]",
    "details": {
      "field": "lat",
      "value": 99.9,
      "constraint": "range [18.0, 54.0]"
    }
  },
  "traceId": "3f2a1b8c-..."
}
```

### A.3 频率限制

请求：（距上次上报仅 2 秒）

响应：
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "上报频率过高，请降速至 5 秒以上",
    "details": {
      "driverId": "clx7a8b9c0001xyzabc",
      "retryAfterMs": 3000
    }
  },
  "traceId": "3f2a1b8c-..."
}
```

---

## 附录 B：与现有实现的对齐说明

当前 `feature-admin-workflow/src/app/api/driver/location/route.ts` 为先行占位实现：

| 能力 | 当前占位实现 | 本协议目标 |
|------|------------|-----------|
| 坐标字段 | `lat`, `lng`, `driverId`, `updatedAt` | 扩展至 `accuracy`, `speed`, `altitude`, `direction`, `provider`, `orderId`, `batteryLevel`, `networkType` |
| 持久化 | `persisted: false`（无 driver_locations 表） | 双写 Tair + RDS |
| 数据存储 | 无 | Tair Hash + RDS driver_location_logs 表 |
| 频率控制 | 无 | 滑动窗口限流 |
| 坐标校验 | `parseCoordinate`（仅 isFinite） | 增加中国境内范围校验 |
| 离线判定 | 无 | 查询侧判断（90s 弱信号 / 180s 离线） |
| 服务端调速 | 无 | 响应 `nextReportIntervalMs` |
| 鉴权 | 数据库查 driver.isActive | JWT token + driverId 一致性校验 |

本协议为 `driver-workflow` 阶段（阶段 10）的生产级实现目标。当前占位实现保证接口契约可用，后续按本协议逐步升级。

---

## 附录 C：版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-04 | 初始冻结版本，定义完整位置上报协议 |

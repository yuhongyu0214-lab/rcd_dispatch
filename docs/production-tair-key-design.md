# 人车单调度系统 — Tair/Redis 缓存 Key 设计

> 版本：v1.0（冻结）
> 日期：2026-07-04
> 作者：架构组
> 适用范围：生产环境阿里云 Tair（Redis 兼容 5.0+）

---

## 目录

1. [设计目标](#1-设计目标)
2. [Key 命名规范](#2-key-命名规范)
3. [Key 总览](#3-key-总览)
4. [Key 详细设计](#4-key-详细设计)
   - [4.1 driver:last_location:{driverId}](#41-driverlast_locationdriverid)
   - [4.2 driver:online:{driverId}](#42-driveronlinedriverid)
   - [4.3 eta:{orderId}:{driverId}:driving](#43-etaorderiddriveriddriving)
   - [4.4 dispatch:lock:{orderId}](#44-dispatchlockorderid)
   - [4.5 map:snapshot:{storeId}](#45-mapsnapshotstoreid)
5. [连接配置](#5-连接配置)
6. [降级策略](#6-降级策略)
7. [内存估算](#7-内存估算)
8. [安全策略](#8-安全策略)
9. [Pipeline 与批量操作规范](#9-pipeline-与批量操作规范)
10. [运维手册](#10-运维手册)
11. [变更记录](#11-变更记录)

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| 热数据分层 | Tair 承载高频读写（司机位置、在线心跳、ETA 短缓存），RDS PostgreSQL 承载事实数据与审计日志 |
| 写不丢 | Tair 不可用时自动降级到 RDS 最近采样，保证系统可用 |
| 防并发 | 派单短锁防止同一订单被双写，与 Prisma `$transaction` 双层防护 |
| 可观测 | 所有 Key 读写操作携带 traceId 日志，缓存命中率、降级次数纳入生产指标 |
| 成本可控 | TTL 策略严格控制内存占用，按 1000 在线司机估算内存 < 50MB |

---

## 2. Key 命名规范

### 2.1 命名规则

```
{domain}:{entity}:{scope}
```

| 组成部分 | 说明 | 示例 |
|----------|------|------|
| `domain` | 业务域，全小写字母 | `driver`, `eta`, `dispatch`, `map` |
| `entity` | 实体语义，snake_case | `last_location`, `online` |
| `scope` | 限定参数，用 `{}` 包裹 | `{driverId}`, `{orderId}` |

### 2.2 分隔符

- **段分隔符**：冒号 `:` — 标准 Redis 命名分隔，支持 `SCAN` 按段匹配
- **多值组合**：冒号串联（如 `eta:{orderId}:{driverId}:driving`），不使用管道符或逗号

### 2.3 版本号

- V1 阶段 Key 名称不含版本后缀
- 如需引入不兼容的数据结构变更，新 Key 增加 `:v2` 后缀（如 `driver:last_location:v2:{driverId}`），新旧 Key 共存一个 TTL 周期后切换

### 2.4 前缀

- 所有业务 Key 统一前缀：`rcd:`（Ride-Car-Dispatch 缩写）
- 示例：`rcd:driver:last_location:{driverId}`
- 说明：前缀在 Tair 实例级别通过业务隔离，若不与其他应用共享实例可不加前缀；共享实例时必须启用

### 2.5 禁止事项

- 禁止使用中文或特殊字符作为 Key 组成部分
- 禁止超过 256 字符的 Key 长度
- 禁止使用 `KEYS *` 命令（生产环境用 `SCAN` 替代）
- 禁止将二进制数据直接作为 Key（如 `driver:photo:{md5}`）

---

## 3. Key 总览

| Key Pattern | 数据类型 | TTL | 写频率 | 读频率 | 说明 |
|---|---|---|---|---|---|
| `driver:last_location:{driverId}` | Hash | 5 min | 高（每 3-5s） | 中（地图看板刷新） | 司机最新 GPS 位置 |
| `driver:online:{driverId}` | String | 5 min | 中（每 10-30s） | 高（调度筛选） | 在线心跳 |
| `eta:{orderId}:{driverId}:driving` | String(JSON) | 60s | 低（推荐派单） | 中（结果展示） | ETA 缓存 |
| `dispatch:lock:{orderId}` | String | 10s | 低（派单确认） | 低（派单确认） | 派单短锁 |
| `map:snapshot:{storeId}` | String(JSON) | 10s | 低（看板刷新） | 高（多人看板） | 门店地图快照 |

> 说明：若 Tair 实例与其他应用共享，所有 Key 加 `rcd:` 前缀（如 `rcd:driver:last_location:{driverId}`）。
> 下文示例均以无前缀形式书写，实际部署时按实例隔离策略决定。

---

## 4. Key 详细设计

### 4.1 driver:last_location:{driverId}

#### 4.1.1 基本信息

| 属性 | 值 |
|------|-----|
| 数据类型 | Hash |
| TTL | 300s（5 分钟） |
| 写频率 | 高（司机端每 3-5 秒上报一次，1000 司机约 200-333 QPS） |
| 读频率 | 中（调度台地图看板刷新，按门店聚合读取） |
| 降级数据源 | RDS `driver_locations` 表最近一条记录 |

#### 4.1.2 字段定义

| Hash Field | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `lat` | string(浮点) | 是 | 纬度，高德坐标系（GCJ-02） | `30.57226` |
| `lng` | string(浮点) | 是 | 经度，高德坐标系（GCJ-02） | `104.06654` |
| `accuracy` | string(浮点) | 否 | GPS 精度（米），来自微信 `wx.getLocation` | `15.5` |
| `speed` | string(浮点) | 否 | 瞬时速度（km/h） | `32.0` |
| `direction` | string(整型) | 否 | 方向角（0-359 度），-1 表示无方向 | `180` |
| `altitude` | string(浮点) | 否 | 海拔（米） | `500.2` |
| `ts` | string(整型) | 是 | 位置采集时间戳（毫秒，设备本地时间） | `1710076800000` |
| `server_ts` | string(整型) | 是 | 服务端接收时间戳（毫秒） | `1710076800123` |
| `loc_type` | string(整型) | 否 | 定位类型：0=GPS, 1=基站, 2=WiFi, 3=混合 | `0` |
| `status` | string | 是 | 司机当前任务状态（与 `DriverStatus` 枚举对齐） | `S2` |

#### 4.1.3 写入命令

```redis
HMSET driver:last_location:{driverId}
  lat "30.57226"
  lng "104.06654"
  accuracy "15.5"
  speed "32.0"
  direction "180"
  altitude "500.2"
  ts "1710076800000"
  server_ts "1710076800123"
  loc_type "0"
  status "S2"

EXPIRE driver:last_location:{driverId} 300
```

#### 4.1.4 读取命令

```redis
HGETALL driver:last_location:{driverId}
```

#### 4.1.5 业务说明

- 司机端微信小程序通过 `POST /api/driver/location` 上报，后端校验后写入 Tair
- `ts` 使用设备端时间戳，`server_ts` 使用服务端 `Date.now()`，两者差值用于判断网络延迟
- `accuracy` > 100 米时，前端展示"信号弱"标记
- 当前 `feature-admin-workflow` 阶段该 API 为契约预留（`persisted: false`），本 Key 设计为生产化落地目标
- 写入后异步采样写入 RDS（每 30 秒或状态变更时），不阻塞 API 响应

#### 4.1.6 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DriverLastLocation",
  "type": "object",
  "properties": {
    "lat": { "type": "string", "pattern": "^-?\\d+(\\.\\d+)?$" },
    "lng": { "type": "string", "pattern": "^-?\\d+(\\.\\d+)?$" },
    "accuracy": { "type": "string", "pattern": "^\\d+(\\.\\d+)?$" },
    "speed": { "type": "string", "pattern": "^-?\\d+(\\.\\d+)?$" },
    "direction": { "type": "string", "pattern": "^-?\\d+$" },
    "altitude": { "type": "string", "pattern": "^-?\\d+(\\.\\d+)?$" },
    "ts": { "type": "string", "pattern": "^\\d{13}$" },
    "server_ts": { "type": "string", "pattern": "^\\d{13}$" },
    "loc_type": { "type": "string", "enum": ["0", "1", "2", "3"] },
    "status": { "type": "string", "enum": ["OFFLINE", "S1", "S2", "S3", "S4", "UNAVAILABLE"] }
  },
  "required": ["lat", "lng", "ts", "server_ts", "status"]
}
```

---

### 4.2 driver:online:{driverId}

#### 4.2.1 基本信息

| 属性 | 值 |
|------|-----|
| 数据类型 | String（存储时间戳） |
| TTL | 300s（5 分钟） |
| 写频率 | 中（每 10-30 秒心跳一次，1000 司机约 33-100 QPS） |
| 读频率 | 高（调度引擎预筛候选人、地图筛选在线司机） |
| 降级数据源 | RDS `driver` 表 `status` 字段 + `updatedAt` |

#### 4.2.2 数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| value | string(整型) | 最后心跳时间戳（毫秒，`Date.now()`） |

#### 4.2.3 写入命令

```redis
SET driver:online:{driverId} "1710076800000" EX 300
```

#### 4.2.4 读取命令

```redis
-- 检查单个司机是否在线
EXISTS driver:online:{driverId}

-- 批量检查门店内在线司机
-- 先将候选 driverId 列表通过 Pipeline 批量 EXISTS，再过滤
```

#### 4.2.5 业务说明

- 司机端小程序在位置上报时顺带续期心跳，或独立发送心跳请求
- 调度引擎筛选候选人时，仅考虑 `driver:online:{driverId}` 存在的司机（与 `DISPATCHABLE_DRIVER_STATUSES` 交叉过滤）
- TTL 5 分钟意味着司机离线后最多 5 分钟后才被标记为离线；若需要更快的离线检测可将 TTL 缩短至 2-3 分钟
- 与 `driver:last_location:{driverId}` 的 TTL 一致，确保位置和在线状态同步过期

#### 4.2.6 JSON Schema

不适用（String 类型，值为毫秒时间戳字符串）。

---

### 4.3 eta:{orderId}:{driverId}:driving

#### 4.3.1 基本信息

| 属性 | 值 |
|------|-----|
| 数据类型 | String（JSON） |
| TTL | 60s（1 分钟） |
| 写频率 | 低（仅在 `runDispatch()` 推荐派单时写入） |
| 读频率 | 中（调度台展示推荐结果、前端防重复调用） |
| 降级数据源 | 高德 API 实时查询；失败则使用 `fallbackEtaByStatus` 降级值 |

#### 4.3.2 字段定义

| JSON Field | 类型 | 必填 | 说明 |
|---|---|---|---|
| `driverId` | string | 是 | 司机 ID |
| `orderId` | string | 是 | 订单 ID |
| `etaMinutes` | number | 是 | 预计到达时间（分钟） |
| `distanceMeters` | number | 是 | 行驶距离（米） |
| `durationSeconds` | number | 是 | 行驶时长（秒，高德原始值） |
| `etaStatus` | string | 是 | `NORMAL`（正常）/ `EXCEEDED`（ETA>=120 需人工判断）/ `FALLBACK`（降级估算）/ `FAILED`（高德调用失败） |
| `polyline` | string | 否 | 高德路线折线编码，可选，用于地图展示路径 |
| `amapReqId` | string | 否 | 高德请求 ID，用于问题排查 |
| `cachedAt` | number | 是 | 缓存写入时间（毫秒时间戳） |

#### 4.3.3 写入命令

```redis
SET eta:{orderId}:{driverId}:driving '{
  "driverId": "clx...",
  "orderId": "cly...",
  "etaMinutes": 18,
  "distanceMeters": 5200,
  "durationSeconds": 1080,
  "etaStatus": "NORMAL",
  "polyline": "116.123,39.456;...",
  "amapReqId": "abc123",
  "cachedAt": 1710076800000
}' EX 60
```

#### 4.3.5 读取策略

```
1. 推荐派单时，先查 Tair 是否存在有效的 eta:{orderId}:{driverId}:driving Key
2. 命中（且 etaStatus != "FAILED" 且 age < 50s）→ 直接使用缓存值
3. 未命中 → 调用 fetchAmapEtaMinutes() → 写入 Tair → 返回
4. 高德调用失败 → 使用 fallbackEtaByStatus 降级值，etaStatus = "FALLBACK"，仍写入缓存（TTL 30s）
```

#### 4.3.6 与现有关键逻辑对照

当前 `eta.ts` 的降级映射：

```typescript
// source: feature-admin-workflow/src/lib/dispatch/eta.ts
const fallbackEtaByStatus: Record<DriverStatus, number> = {
  S1: 18, S2: 28, S3: 42, S4: 58,
  OFFLINE: 9999, UNAVAILABLE: 9999
};
```

缓存后的行为：`S1` 司机在无 GPS 时会命中降级值 18 分钟（+ jitter）。若之前已缓存正常 ETA，则优先使用缓存。

#### 4.3.7 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EtaCache",
  "type": "object",
  "properties": {
    "driverId": { "type": "string" },
    "orderId": { "type": "string" },
    "etaMinutes": { "type": "number", "minimum": 0 },
    "distanceMeters": { "type": "number", "minimum": 0 },
    "durationSeconds": { "type": "number", "minimum": 0 },
    "etaStatus": { "type": "string", "enum": ["NORMAL", "EXCEEDED", "FALLBACK", "FAILED"] },
    "polyline": { "type": "string" },
    "amapReqId": { "type": "string" },
    "cachedAt": { "type": "number" }
  },
  "required": ["driverId", "orderId", "etaMinutes", "distanceMeters", "durationSeconds", "etaStatus", "cachedAt"]
}
```

---

### 4.4 dispatch:lock:{orderId}

#### 4.4.1 基本信息

| 属性 | 值 |
|------|-----|
| 数据类型 | String |
| TTL | 10s |
| 写频率 | 低（仅在调度员点击"确认派单"时写入） |
| 读频率 | 低（仅在派单确认流程中使用） |
| 降级数据源 | Prisma `$transaction` 内置乐观锁（`updateMany` where status 条件） |

#### 4.4.2 字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| value | string | 持有锁的 traceId，用于问题排查和死锁诊断 |

#### 4.4.3 写入命令（获取锁）

```redis
-- NX: 仅当 Key 不存在时设置成功（原子操作）
-- EX 10: 10 秒后自动释放，防止死锁
SET dispatch:lock:{orderId} "{traceId}" NX EX 10
```

返回值：`OK` = 获取锁成功；`(nil)` = 锁已被他人持有。

#### 4.4.4 释放命令

```redis
-- Lua 脚本：仅当 value 匹配时才删除（防止误删他人锁）
EVAL "
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
" 1 dispatch:lock:{orderId} {traceId}
```

#### 4.4.5 与现有 confirm.ts 的集成

当前 `confirm.ts` 使用 Prisma `updateMany` 乐观锁：

```typescript
// source: feature-admin-workflow/src/lib/dispatch/confirm.ts (L80-L91)
const lockedOrder = await tx.order.updateMany({
  where: {
    id: input.orderId,
    status: { in: ["PENDING", "RECOMMENDING"] },
    currentAssignmentId: order.currentAssignmentId
  },
  data: { status: "ASSIGNED", driverNameSnapshot: driver.name }
});
if (lockedOrder.count !== 1) return null;
```

引入 Tair 后的双层锁流程：

```
1. 前端点击"确认派单"
2. 后端尝试获取 dispatch:lock:{orderId}（SET NX EX 10）
3. 未获取到锁 → 返回 409 "订单正在处理中，请刷新后重试"
4. 获取到锁 → 进入 Prisma $transaction（复用现有乐观锁逻辑）
5. 事务成功 → 释放锁（Lua 脚本安全删除）
6. 事务失败 → 释放锁，返回 409
7. 任何异常 → TTL 10s 自动释放，不会死锁
```

#### 4.4.6 锁超时分析

- 正常派单流程约 50-200ms（一次 DB 事务 + 操作日志写入）
- 极端情况（DB 延迟）最多等待 Prisma `$transaction` timeout（当前 15000ms）
- Tair 锁 TTL 设为 10s：覆盖正常流程绰绰有余，同时保证 DB 卡死后锁迅速释放

---

### 4.5 map:snapshot:{storeId}

#### 4.5.1 基本信息

| 属性 | 值 |
|------|-----|
| 数据类型 | String（JSON） |
| TTL | 10s |
| 写频率 | 低（调度台第一次请求或 TTL 过期后刷新） |
| 读频率 | 高（同一门店多调度员同时打开地图） |
| 降级数据源 | 直接查询 RDS + Tair 位置数据聚合 |

#### 4.5.2 字段定义

| JSON Field | 类型 | 必填 | 说明 |
|---|---|---|---|
| `storeId` | string | 是 | 门店 ID |
| `orders` | array | 是 | 订单点位摘要列表 |
| `orders[].orderId` | string | 是 | 订单 ID |
| `orders[].lat` | number | 是 | 纬度 |
| `orders[].lng` | number | 是 | 经度 |
| `orders[].status` | string | 是 | 订单状态 |
| `orders[].type` | string | 是 | 订单类型 |
| `drivers` | array | 是 | 司机点位摘要列表 |
| `drivers[].driverId` | string | 是 | 司机 ID |
| `drivers[].lat` | number | 是 | 纬度（来自 `driver:last_location`） |
| `drivers[].lng` | number | 是 | 经度 |
| `drivers[].status` | string | 是 | 司机状态 |
| `drivers[].online` | boolean | 是 | 是否在线 |
| `generatedAt` | number | 是 | 快照生成时间戳（毫秒） |

#### 4.5.3 写入命令

```redis
SET map:snapshot:{storeId} '{
  "storeId": "st_001",
  "orders": [
    { "orderId": "o1", "lat": 30.572, "lng": 104.066, "status": "PENDING", "type": "STORE_PICKUP" }
  ],
  "drivers": [
    { "driverId": "d1", "lat": 30.573, "lng": 104.068, "status": "S2", "online": true }
  ],
  "generatedAt": 1710076800000
}' EX 10
```

#### 4.5.4 生成策略

```
1. 前端请求 GET /api/map/snapshot?storeId=xxx
2. 后端检查 Tair: map:snapshot:{storeId}
3. 命中 → 直接返回（避免重复聚合查询）
4. 未命中 → 并行查询:
   a. RDS: 该门店 PENDING/ASSIGNED/ACCEPTED 状态的订单及坐标
   b. Tair: 该门店所有司机的 driver:last_location:* 和 driver:online:*
   c. RDS: 该门店基础信息
5. 组装 snapshot JSON → 写入 Tair → 返回
```

#### 4.5.5 设计考量

- TTL 只有 10s，因为司机位置 3-5s 更新一次，10s 的快照会很快过时
- 快照适合"地图初始加载"，后续位置更新通过 SSE/WebSocket 差量推送
- 不同门店的快照互不影响
- 若同一门店有 5 个调度员同时打开地图，只有第一个请求触发聚合，其余命中缓存

#### 4.5.6 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MapSnapshot",
  "type": "object",
  "properties": {
    "storeId": { "type": "string" },
    "orders": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "orderId": { "type": "string" },
          "lat": { "type": "number" },
          "lng": { "type": "number" },
          "status": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["orderId", "lat", "lng", "status", "type"]
      }
    },
    "drivers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "driverId": { "type": "string" },
          "lat": { "type": "number" },
          "lng": { "type": "number" },
          "status": { "type": "string" },
          "online": { "type": "boolean" }
        },
        "required": ["driverId", "lat", "lng", "status", "online"]
      }
    },
    "generatedAt": { "type": "number" }
  },
  "required": ["storeId", "orders", "drivers", "generatedAt"]
}
```

---

## 5. 连接配置

### 5.1 Tair 实例参数

```env
# .env.local（生产环境）
TAIR_URL=redis://rcd-prod.redis.rds.aliyuncs.com:6379
TAIR_PASSWORD=xxxxxxxxxxxxxxxx
TAIR_DB=0

# 连接池配置
TAIR_POOL_MIN=4                  # 最小连接数（空闲保留）
TAIR_POOL_MAX=50                 # 最大连接数
TAIR_POOL_IDLE_TIMEOUT_MS=30000  # 空闲连接超时（30s 释放）
TAIR_POOL_ACQUIRE_TIMEOUT_MS=5000 # 获取连接超时（5s）
```

### 5.2 连接池设置

使用 `ioredis`（Node.js Redis 客户端首选）：

```typescript
// lib/tair.ts — Tair 连接单例
import Redis from "ioredis";

let tair: Redis | null = null;

export function getTair(): Redis {
  if (tair) return tair;

  const url = process.env.TAIR_URL;
  if (!url) {
    throw new Error("TAIR_URL is not configured");
  }

  tair = new Redis(url, {
    password: process.env.TAIR_PASSWORD || undefined,
    db: Number(process.env.TAIR_DB) || 0,
    // 连接池
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null; // 停止重试
      return Math.min(times * 200, 2000);
    },
    // 连接超时
    connectTimeout: 5000,
    // 命令超时
    commandTimeout: 3000,
    // 重连
    reconnectOnError(err) {
      const targetErrors = ["READONLY", "CONNECTION_BROKEN"];
      return targetErrors.some((e) => err.message.includes(e));
    },
    // 延迟监控
    enableOfflineQueue: false, // Tair 不可用时快速失败，不排队
    lazyConnect: true
  });

  tair.on("error", (err) => {
    console.error("[tair] connection error", err);
  });

  tair.on("connect", () => {
    console.log("[tair] connected");
  });

  return tair;
}
```

### 5.3 超时配置汇总

| 操作 | 超时 | 说明 |
|------|------|------|
| TCP 连接建立 | 5s | `connectTimeout` |
| 单条命令执行 | 3s | `commandTimeout` |
| 连接池获取连接 | 5s | `TAIR_POOL_ACQUIRE_TIMEOUT_MS` |
| Pipeline 批量执行 | 5s | 自定义 Promise.race 包装 |
| 降级阈值 | 连续 3 次失败 | 触发降级，后续请求直接走 RDS |
| 降级恢复探测 | 每 30s 尝试 1 次 | 探测成功则恢复 Tair 访问 |

---

## 6. 降级策略

### 6.1 降级触发条件

| 条件 | 检测方式 | 动作 |
|------|----------|------|
| Tair 连接失败 | `connectTimeout` 超时或 `ECONNREFUSED` | 标记 `tairDegraded=true`，当前请求走降级 |
| 命令连续失败 3 次 | 计数器（滑动窗口 10s） | 标记 `tairDegraded=true`，启动恢复探测 |
| 命令耗时 > 3s | `commandTimeout` | 单次降级，不标记全局 |

### 6.2 各 Key 降级行为

| Key | 写操作降级 | 读操作降级 |
|-----|----------|----------|
| `driver:last_location:{driverId}` | 直接写入 RDS `driver_locations` 表，无缓存 | 读取 RDS `driver_locations` 最近一条（`ORDER BY created_at DESC LIMIT 1`） |
| `driver:online:{driverId}` | 无写降级（心跳丢失容忍 5min） | 读取 RDS `driver.status` 字段 + `driver.updatedAt`（5 分钟内有更新视为在线） |
| `eta:{orderId}:{driverId}:driving` | 直接调用高德 API，不缓存 | 直接调用高德 API；高德也失败则用 `fallbackEtaByStatus` |
| `dispatch:lock:{orderId}` | 跳过 Tair 锁，仅依赖 Prisma `$transaction` 乐观锁 | 跳过 Tair 锁检查 |
| `map:snapshot:{storeId}` | 不写缓存，每次实时聚合 | 实时聚合查询（RDS + 降级后的位置数据） |

### 6.3 降级恢复

```
class TairCircuitBreaker {
  private degraded = false;
  private failureCount = 0;
  private lastProbeTime = 0;
  private readonly PROBE_INTERVAL = 30_000; // 30s
  private readonly MAX_FAILURES = 3;

  async probe(): Promise<void> {
    if (!this.degraded) return;
    if (Date.now() - this.lastProbeTime < this.PROBE_INTERVAL) return;

    this.lastProbeTime = Date.now();
    try {
      await getTair().ping();
      this.degraded = false;
      this.failureCount = 0;
      console.log("[tair] circuit breaker reset — Tair recovered");
    } catch {
      // 保持降级，下次探测间隔后再试
    }
  }
}
```

---

## 7. 内存估算

### 7.1 估算基准

- 在线司机数：1000 人
- 字符编码：UTF-8
- Redis 内部 overhead：约 50-60 bytes 每个 Key（字典 + 过期时间 + 对象头）

### 7.2 逐 Key 估算

#### driver:last_location:{driverId} (Hash)

| 项目 | 值 |
|------|-----|
| 数量 | 1000 个 Key |
| 每个 Hash 10 个 field | field 名合计约 60 bytes + value 合计约 80 bytes |
| 单个 Key 数据量 | ~200 bytes |
| 1000 个总数据量 | ~200 KB |

#### driver:online:{driverId} (String)

| 项目 | 值 |
|------|-----|
| 数量 | 1000 个 Key |
| 单个 Key（13 位时间戳） | ~70 bytes（含 overhead） |
| 1000 个总数据量 | ~70 KB |

#### eta:{orderId}:{driverId}:driving (String/JSON)

| 项目 | 值 |
|------|-----|
| 数量 | 假设 50 个活跃订单 x 平均 5 个候选人 = 250 个 Key |
| 单个 Key（JSON） | ~350 bytes |
| 250 个总数据量 | ~87 KB |

#### dispatch:lock:{orderId} (String)

| 项目 | 值 |
|------|-----|
| 数量 | 同时最多 1-3 个 Order 在执行派单确认 |
| 单个 Key | ~70 bytes |
| 峰值总数据量 | ~210 bytes（可忽略） |

#### map:snapshot:{storeId} (String/JSON)

| 项目 | 值 |
|------|-----|
| 数量 | 假设 10 个门店 |
| 单个 Key（JSON，含订单+司机摘要） | ~5-15 KB（取决于门店订单和司机数量） |
| 按每门店 50 订单 + 30 司机估算 | ~8 KB |
| 10 个门店总数据量 | ~80 KB |

### 7.3 汇总

| 类别 | 内存占用 |
|------|---------|
| driver:last_location | ~200 KB |
| driver:online | ~70 KB |
| eta 缓存 | ~87 KB |
| dispatch:lock | < 1 KB |
| map:snapshot | ~80 KB |
| Redis 内部 overhead（~20%） | ~88 KB |
| **总计（1000 在线司机）** | **~525 KB** |
| **总计（含 30% 安全余量）** | **~680 KB** |

结论：1000 在线司机场景下，Tair 热数据内存占用 < 1 MB。即使扩展到 10000 司机，也仅约 6-7 MB。最低配 Tair 实例（1GB 标准版）完全满足需求。

### 7.4 峰值场景

| 场景 | 额外内存 |
|------|---------|
| 所有 1000 司机同时上报位置（pipeline 缓冲） | 瞬时 +200 KB，pipeline 执行后释放 |
| 突发大量 ETA 缓存（调度员批量推荐） | 瞬时 +500 KB（1000 个 eta key），60s 后过期 |
| 峰值总内存（含余量） | < 2 MB |

---

## 8. 安全策略

### 8.1 密码管理

| 措施 | 说明 |
|------|------|
| 环境变量注入 | Tair 密码通过 `.env.local` / Railway 环境变量注入，不进入代码仓库 |
| 禁止硬编码 | `.gitignore` 已排除 `.env.local`，CI/CD 通过 Secret 注入 |
| 密码复杂度 | 32 位以上随机字符串，含大小写字母 + 数字 + 特殊字符 |
| 定期轮换 | 每季度轮换，通过阿里云控制台修改，同步更新环境变量 |

### 8.2 网络隔离

| 措施 | 说明 |
|------|------|
| 内网访问 | Tair 实例不开启公网地址，仅允许 VPC 内网访问 |
| 白名单 | 仅允许 Next.js 后端服务器所在 ECS/容器安全组 IP 段访问 |
| 端口 | 仅开放 6379（Redis 默认端口），不暴露其他端口 |
| VPC | Tair 实例与 RDS 实例部署在同一 VPC，减少网络延迟 |

### 8.3 命令白名单

在阿里云 Tair 控制台或通过 `redis.conf` 配置命令白名单，禁用危险命令：

```conf
# 禁用危险命令
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command KEYS ""
rename-command CONFIG ""
rename-command SHUTDOWN ""
rename-command DEBUG ""
rename-command SAVE ""
rename-command BGSAVE ""
rename-command BGREWRITEAOF ""
rename-command SYNC ""
rename-command PSYNC ""
```

保留的命令集（白名单）：

| 分类 | 命令 |
|------|------|
| Key 操作 | `EXISTS`, `DEL`, `EXPIRE`, `TTL`, `SCAN`, `TYPE` |
| String | `SET`, `GET`, `MGET` |
| Hash | `HSET`, `HMSET`, `HGET`, `HGETALL`, `HMGET`, `HDEL` |
| Script | `EVAL`, `EVALSHA` |
| 管理 | `PING`, `INFO`, `CLIENT SETNAME` |
| Pipeline | 所有白名单内命令的批量执行 |

### 8.4 访问控制

- 只读账号用于本地开发和调试（`TAIR_READONLY_URL` 环境变量可选配置）
- 读写账号用于生产服务（`TAIR_URL`）
- 阿里云 RAM 子账号管理实例，最小权限原则

### 8.5 审计

- 所有 Tair 写操作在 Pino 日志中记录：traceId, Key pattern, 操作类型, 耗时
- 不在日志中记录完整 Value（避免泄露坐标和敏感数据）

---

## 9. Pipeline 与批量操作规范

### 9.1 必须使用 Pipeline 的场景

| 场景 | Key 数量 | 说明 |
|------|---------|------|
| 地图看板加载门店所有司机位置 | 按门店 30-50 个 Key | 批量 `HGETALL` |
| 检查门店司机在线状态 | 按门店 30-50 个 Key | 批量 `EXISTS` |
| 调度引擎写 ETA 缓存（Top N 候选） | 3-10 个 Key | 批量 `SET` |
| 司机下线清理 | 2 个 Key | `DEL location` + `DEL online` |

### 9.2 Pipeline 使用规范

```typescript
// 示例：批量获取门店所有司机位置
async function getStoreDriverLocations(storeId: string): Promise<Map<string, DriverLocation>> {
  const tair = getTair();

  // 1. 先用 SCAN 获取该门店所有位置 Key
  //    注意：SCAN 可能需多次迭代，生产环境使用稳定的 driverId 列表
  const driverIds = await getStoreDriverIds(storeId); // 从 RDS 获取

  if (driverIds.length === 0) return new Map();

  // 2. Pipeline 批量 HGETALL
  const pipeline = tair.pipeline();
  for (const driverId of driverIds) {
    pipeline.hgetall(`driver:last_location:${driverId}`);
  }

  const results = await pipeline.exec();
  // results: Array<[Error | null, Record<string, string> | null]>

  const locations = new Map<string, DriverLocation>();
  driverIds.forEach((driverId, index) => {
    const [err, data] = results[index];
    if (!err && data && Object.keys(data).length > 0) {
      locations.set(driverId, parseLocationHash(data));
    }
  });

  return locations;
}
```

### 9.3 Pipeline 注意事项

| 规则 | 说明 |
|------|------|
| **单 pipeline 上限** | 单次 pipeline 不超过 200 条命令，超过则分批执行 |
| **不依赖顺序** | pipeline 中的命令不应有相互依赖关系 |
| **事务性** | pipeline 不等于事务（不保证原子性），如需原子性使用 `MULTI/EXEC`（但不推荐，会影响性能） |
| **错误处理** | pipeline 中单个命令失败不影响其他命令，需逐条检查 `results[i][0]`（Error 对象） |
| **超时** | 使用 `Promise.race([pipeline.exec(), timeout(5000)])` 防止 pipeline 挂起 |

### 9.4 Lua 脚本规范

适用场景：需要原子性地"读取 + 判断 + 写入"。

```lua
-- 示例：安全写入司机位置 + 续期在线心跳（原子操作）
-- KEYS[1] = driver:last_location:{driverId}
-- KEYS[2] = driver:online:{driverId}
-- ARGV[1..N] = HMSET 参数对
-- ARGV[N+1] = TTL (秒)

redis.call('HMSET', KEYS[1], unpack(ARGV, 1, #ARGV - 1))
redis.call('EXPIRE', KEYS[1], ARGV[#ARGV])

redis.call('SET', KEYS[2], ARGV[#ARGV - 1], 'EX', ARGV[#ARGV])

return 1
```

Lua 脚本使用规范：

| 规则 | 说明 |
|------|------|
| **预加载** | 使用 `SCRIPT LOAD` 预加载脚本，执行时用 `EVALSHA` 减少带宽 |
| **参数化** | 禁止在 Lua 中拼接 Key 字符串，通过 `KEYS[]` 和 `ARGV[]` 传入 |
| **无阻塞** | Lua 脚本执行期间 Redis 单线程阻塞，脚本耗时 < 1ms |
| **不跨 slot** | 集群模式下，Lua 脚本涉及的所有 Key 必须在同一 hash slot（使用 `{hashTag}`） |
| **版本管理** | 脚本变更时生成新的 SHA，旧 SHA 通过 `SCRIPT FLUSH` 清理（仅开发环境） |

### 9.5 禁止操作

| 操作 | 原因 | 替代方案 |
|------|------|---------|
| `KEYS *` | 阻塞 Redis，生产禁用 | `SCAN` 游标迭代 |
| 单次 pipeline > 200 命令 | 内存压力 + 长时间占用连接 | 分批执行 |
| 在 pipeline 中混合读写同一 Key | 结果不可预测 | 拆分为独立 pipeline 或用 Lua |
| 无 TTL 的 Key | 内存泄漏 | 所有 Key 必须有 TTL，写操作时必须同时 `EXPIRE` |
| 大 Value（> 1MB） | 阻塞 Redis + 内存碎片 | 拆分为多个 Key 或使用 RDS |

---

## 10. 运维手册

### 10.1 日常监控

```bash
# Tair 实例基础监控（通过阿里云控制台或 API）
curl -s "https://{tair-instance-id}.redis.rds.aliyuncs.com:6379/info" \
  -u "{username}:{password}" | grep -E "used_memory|connected_clients|keyspace_hits|keyspace_misses"
```

关键指标：

| 指标 | 告警阈值 | 处理建议 |
|------|---------|---------|
| `used_memory` | > 实例规格 80% | 检查有无 Key 缺少 TTL，考虑扩容 |
| `connected_clients` | > pool max * 1.5 | 检查连接泄漏 |
| `keyspace_misses / hits` | miss rate > 30% | TTL 可能过短，或 Key 未被正确写入 |
| 命令延迟 P99 | > 10ms | 检查网络、大 Key、慢查询 |

### 10.2 慢查询排查

```bash
# 查看最近 10 条慢查询
redis-cli -h {host} -a {password} SLOWLOG GET 10
```

定义：执行时间 > 5ms 的命令记录到慢查询日志。

### 10.3 缓存预热

新部署或 Tair 重启后，可选择性预热：

```
1. driver:online:* — 不需要预热（心跳自动填充）
2. driver:last_location:* — 不需要预热（位置上报自动填充）
3. eta:* — 不需要预热（按需计算 + 缓存）
4. dispatch:lock:* — 不需要预热（按需获取）
5. map:snapshot:* — 第一个请求触发聚合生成
```

结论：V1 阶段不需要缓存预热逻辑，依赖懒加载 + 降级即可。

### 10.4 数据清理

| 场景 | 操作 |
|------|------|
| 司机离线 | `DEL driver:online:{driverId}`（心跳 TTL 也自动过期） |
| 司机位置过期 | TTL 自动删除（300s），不手动干预 |
| 订单完结 | 不主动清理 eta 缓存（60s TTL 自动过期） |
| 派单锁异常 | TTL 自动释放（10s），不手动干预 |
| 全量清理（维护窗口） | `SCAN 0 MATCH driver:* COUNT 100` + 逐批 `DEL` |

---

## 11. 变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-07-04 | 初始版本，冻结 5 个业务 Key 设计、连接配置、降级策略、内存估算、安全策略、Pipeline 规范 | 架构组 |

---

## 附录 A：与现有代码的对应关系

| Tair Key | 关联源码文件 | 当前状态 | 生产化改造点 |
|----------|------------|---------|------------|
| `driver:last_location:{driverId}` | `feature-admin-workflow/src/app/api/driver/location/route.ts` | 契约预留（`persisted: false`） | 实现 Tair Hash 写入 + 异步 RDS 采样 |
| `driver:online:{driverId}` | `feature-admin-workflow/src/lib/dispatch/engine.ts`（`DISPATCHABLE_DRIVER_STATUSES`） | 仅查 RDS `driver.status` | 增加 Tair `EXISTS` 检查 |
| `eta:{orderId}:{driverId}:driving` | `feature-admin-workflow/src/lib/dispatch/eta.ts` | 每次实时调高德 API | 增加 Tair 读写缓存层 |
| `dispatch:lock:{orderId}` | `feature-admin-workflow/src/lib/dispatch/confirm.ts` | 仅 Prisma `updateMany` 乐观锁 | 增加 `SET NX` 前置锁 |
| `map:snapshot:{storeId}` | `feature-admin-workflow/src/app/admin/map/` | 前端直接查询 API 聚合 | 后端增加缓存层 |

## 附录 B：Tair 实例规格建议

| 项 | 建议值 | 依据 |
|-----|-------|------|
| 版本 | Redis 5.0 兼容 | 阿里云 Tair 默认兼容版本 |
| 规格 | 1GB 标准版 | 1000 在线司机 < 2MB，1GB 留足余量 |
| 副本 | 主备（1 主 1 备） | 生产必备高可用 |
| 地域 | 与 RDS、ECS 同地域同可用区 | 降低网络延迟 |
| 带宽 | 默认（10 MB/s） | 1000 司机 x 位置上报 200 QPS x 0.2KB = 40KB/s 写入 |
| 连接数 | 最大 10000（默认） | pool max=50，实际并发连接 < 100 |

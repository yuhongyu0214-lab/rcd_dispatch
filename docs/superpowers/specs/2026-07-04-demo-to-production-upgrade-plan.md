# 人车单调度系统 — Demo原型 → 生产级应用 升级方案

版本：2026-07-04
作者：Claude Code（全网研究 + 架构设计）
用途：作为 demo 原型升级为生产级可部署软件的可执行方案

---

## 目录

1. [当前状态诊断](#1-当前状态诊断)
2. [对标开源项目架构参考](#2-对标开源项目架构参考)
3. [技术风险与限制评估](#3-技术风险与限制评估)
4. [数据模型升级方案](#4-数据模型升级方案)
5. [Web端生产级架构](#5-web端生产级架构)
6. [微信小程序司机端方案](#6-微信小程序司机端方案)
7. [高德地图集成方案](#7-高德地图集成方案)
8. [基础设施升级路径](#8-基础设施升级路径)
9. [阶段路线图](#9-阶段路线图)
10. [验收标准](#10-验收标准)

---

## 1. 当前状态诊断

### 1.1 已完成（Demo 阶段）

| 阶段 | 状态 | 交付物 |
|------|------|--------|
| docs-prd | ✅ | 5份业务文档 |
| repo-bootstrap | ✅ | Next.js 14 骨架 + Prisma + Tailwind + shadcn/ui |
| data-model | ✅ | 6张核心表（User/Store/Driver/Vehicle/Order/Assignment/OperationLog） |
| order-import | ✅ | Excel 上传→校验→地理编码→入库 |
| map-board | ✅ | 高德地图 + 订单/司机点位 + 侧边栏联动 |
| admin-workflow | ✅ | 派单/改派/撤回 + 操作日志 |
| dispatch-rule-v1 | ✅ | Top N 推荐 + ETA 计算 + 事务防重复 |
| logging-observe | ✅ | traceId 全链路 + Pino 日志 |
| integration-adapter | ✅ | Mock GPS/哈啰适配器 |
| driver-workflow | ✅ | 4个司机端 API 接口 |
| stabilization | ⬜ | 未开始 |

### 1.2 Demo 与生产级的关键差距

| 维度 | Demo 现状 | 生产级目标 |
|------|-----------|------------|
| **数据库** | Supabase 托管 PostgreSQL | 阿里云 RDS PostgreSQL（字段结构有变更） |
| **实时通信** | HTTP 轮询 / 无实时推送 | WebSocket 实时位置同步 |
| **司机定位** | 无移动端 | 微信小程序实时定位 + 位置上报 |
| **并发承载** | 单机 dev server | 可水平扩展的生产部署 |
| **地图能力** | 点位展示 + 状态着色 | 实时轨迹 + ETA计算 + 路径规划 + 一键导航 |
| **调度算法** | 基础规则过滤 | 加权评分模型 + 多策略切换 |
| **外部对接** | Mock 适配器 | 真实 API 对接（哈啰/高德鹰眼） |

---

## 2. 对标开源项目架构参考

以下三个项目为本方案提供架构参考。注意：**仅借鉴架构思想和模块划分，不修改技术栈。**

### 2.1 核心参考：Fleetbase（最直接对标）

```
GitHub: fleetbase/fleetbase
许可：AGPL-3.0
技术栈：Laravel PHP + Ember.js + WebSocket(SocketCluster) + React Native
Star: 2.4K+
```

**与我们项目的架构映射：**

| Fleetbase 模块 | 我们对应模块 | 借鉴点 |
|---------------|-------------|--------|
| FleetOps Console | `app/admin/map/` + `app/admin/orders/` | 调度控制台布局：地图+左侧工作面板 |
| Navigator App (RN) | 微信小程序司机端 | 接单/导航/签收 三步骤 UI 模式 |
| Storefront App | 不需要（B2B场景） | — |
| FleetOps Engine | `lib/dispatch/engine.ts` | 订单→司机匹配的核心状态机 |
| Real-time Tracking | **需新建** `lib/realtime/` | WebSocket 通道 + 位置广播机制 |
| Telematics | `lib/adapters/gps/` | GPS 设备数据接入抽象层 |
| Route Optimization | **需新建** `lib/routing/` | 高德路径规划 + ETA 计算 |

**关键借鉴：**
- Fleetbase 使用 **SocketCluster** 做实时通道，我们可用 **Socket.IO** 或独立的 WebSocket 微服务
- Fleetbase 的 Navigator App 只有三个核心页面（任务列表 → 任务详情 → 导航），简洁为王，适合微信小程序的包大小限制

### 2.2 调度算法参考：万岳外卖系统

```
GitHub: WanyueKJ/Takeaway-Distribution
技术栈：PHP + UniApp + WebSocket
```

**关键借鉴：加权评分模型**

```
Score = α × 距离分 + β × 当前负载分 + γ × 历史效率分 + δ × 区域优先级
```

生产级实现建议（伪代码，对齐我们现有的 `lib/dispatch/engine.ts`）：

```typescript
// 参考万岳的加权评分 + Mobius 的 α-公平性参数
interface DriverScoreInput {
  driverId: string;
  etaMinutes: number;        // 高德骑行/驾车路径规划 API 返回
  currentLoad: number;       // 当前已接未完成订单数
  historyOnTimeRate: number; // 历史准时率（0-1）
  familiarWithArea: boolean; // 是否常跑该区域
  distanceMeters: number;    // 直线距离（Haversine 快速预筛）
}

function computeDriverScore(input: DriverScoreInput): number {
  const DISTANCE_WEIGHT = 0.35;
  const LOAD_WEIGHT = 0.25;
  const EFFICIENCY_WEIGHT = 0.25;
  const AREA_WEIGHT = 0.15;

  return (
    DISTANCE_WEIGHT  * normalizeInverse(input.distanceMeters, 500, 20000) +
    LOAD_WEIGHT      * normalizeInverse(input.currentLoad, 0, 5) +
    EFFICIENCY_WEIGHT * input.historyOnTimeRate +
    AREA_WEIGHT      * (input.familiarWithArea ? 1 : 0.3)
  );
}
```

### 2.3 高并发架构参考：Realtime Dispatch System

```
GitHub: robert-nguyenn/realtime_dispatch_system
技术栈：Java + Rust(geo-index) + Kafka + Flink
```

**关键借鉴（架构思想，不用其技术栈）：**
- 位置更新与业务处理分离（位置走快速通道，派单走事务通道）
- GeoHash 分区索引（Redis Geo 即可实现）
- 位置更新延迟目标：P95 < 3秒（我们目标 3-5秒）

---

## 3. 技术风险与限制评估

### 3.1 微信小程序端（最高风险）

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **后台定位权限** | 🔴 高 | iOS `requiredBackgroundModes: ["location"]` 审核极严，需物流/出行类目 | 先跑通 Android；iOS 备选方案：前台持续定位 + 定时上报 |
| **包大小限制** | 🟡 中 | 微信小程序主包限 2MB，总包 20MB | 按需加载：地图页独立分包；高德 SDK 用插件模式 |
| **WebSocket 连接稳定性** | 🟡 中 | 小程序切后台可能断连 | 心跳保活 + 断线重连 + 离线队列 |
| **地图组件性能** | 🟡 中 | Marker > 100 个明显卡顿 | 仅渲染可视区 + 点聚合 + 增量更新 |
| **审核合规** | 🔴 高 | 需提供道路运输许可证等资质 | 提前准备资质文件，或走企业主体认证 |
| **wx.getLocation 频率限制** | 🟡 中 | 高频调用可能被限 | 3-5秒上报一次，使用 `wx.startLocationUpdateBackground` |

### 3.2 高德地图（中风险）

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **API QPS 限制** | 🟡 中 | 默认 50 QPS，路径规划更少 | Redis 缓存坐标和路径；批量合并请求 |
| **鹰眼轨迹费用** | 🟡 中 | 按设备数计费 | 评估司机数量，预留预算 |
| **服务端 Key 安全** | 🟢 低 | Key 在后端，不暴露 | 已在 `.env.local` 配置 `AMAP_SERVER_KEY` |
| **前端 JS Key 安全** | 🟡 中 | Key 暴露在前端 | 高德控制台配置域名白名单 + IP限制 |
| **坐标系一致** | 🟢 低 | 微信/高德均为 GCJ02 | 无需转换 |

### 3.3 数据库迁移（中风险）

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **字段变更** | 🟡 中 | 用户提到字段有改变 | 新 schema 先独立验证，迁移脚本加数据清洗 |
| **认证解耦** | 🔴 高 | 从 Supabase Auth 迁移到自建或阿里云方案 | 使用阿里云[官方迁移工具](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/supabase-migration-tool) |
| **RLS 策略** | 🟡 中 | Supabase 默认 RLS 可能在迁移后影响数据访问 | 迁移后重建业务层权限 |
| **PostGIS 兼容** | 🟢 低 | 阿里云 RDS PG 支持 PostGIS | 确认版本一致性 |

### 3.4 Web 端并发（中风险）

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **WebSocket 连接数** | 🔴 高 | Next.js App Router 不支持原生 WebSocket | 独立部署 WebSocket 服务（Socket.IO），前端通过自定义 server 或独立端口连接 |
| **地图大数据量渲染** | 🟡 中 | 1000+ 标记同时渲染卡顿 | 视口裁剪 + 点聚合 + 增量更新 |
| **数据库连接池** | 🟡 中 | Prisma Serverless 环境下连接池耗尽风险 | pgBouncer + Prisma Data Proxy（阿里云侧） |
| **API 限流** | 🟡 中 | 需防高峰流量 | Redis 令牌桶 + API Route 中间件 |

---

## 4. 数据模型升级方案

### 4.1 现有表需要新增的字段

```prisma
// === Driver 表新增 ===
model Driver {
  // ... 现有字段保留 ...

  // 新增：实时位置
  currentLat        Float?              // 当前纬度
  currentLng        Float?              // 当前经度
  locationUpdatedAt DateTime?           // 位置更新时间
  locationSource    String?             // "WECHAT_MINI" | "GPS_DEVICE" | "MANUAL"

  // 新增：调度统计
  totalCompleted    Int     @default(0) // 累计完成订单
  onTimeRate        Float?              // 准时率 (0-1)
  avgCompleteMinutes Float?             // 平均完成时长（分钟）

  // 新增：微信小程序绑定
  wechatOpenId      String?  @unique    // 微信 OpenID
  wechatUnionId     String?             // 微信 UnionID
  wechatNickname    String?             // 微信昵称
  wechatAvatarUrl   String?             // 微信头像
}

// === Order 表新增 ===
model Order {
  // ... 现有字段保留 ...

  // 新增：ETA 与路径
  estimatedArrivalMinutes Int?          // 预计到达时间（分钟）
  routePolyline            String?      // 路径规划 polyline（JSON 数组）
  actualDistanceMeters     Float?       // 实际行驶距离

  // 新增：外部系统映射
  externalOrderId          String?      // 外部系统订单ID（如哈啰）
  externalSource           String?      // "HELLO" | "MANUAL" | "API"

  // 新增：联系人信息（生产级需要）
  customerName             String?      // 客户姓名
  customerPhone            String?      // 客户电话
  customerNotes            String?      // 客户备注
}

// === 新增表：DriverLocationLog ===
// 司机位置上报记录（用于轨迹回放）
model DriverLocationLog {
  id          String   @id @default(cuid())
  driverId    String
  lat         Float
  lng         Float
  accuracy    Float?   // GPS 精度（米）
  speed       Float?   // 速度（km/h）
  direction   Float?   // 方向角（度）
  source      String   @default("WECHAT_MINI") // "WECHAT_MINI" | "GPS_DEVICE"
  createdAt   DateTime @default(now())

  @@index([driverId, createdAt])
  @@index([createdAt])
}

// === 新增表：RouteCache ===
// 高德路径规划缓存（降本 + 提效）
model RouteCache {
  id            String   @id @default(cuid())
  originLat     Float
  originLng     Float
  destLat       Float
  destLng       Float
  routeType     String   @default("DRIVING") // "DRIVING" | "WALKING" | "RIDING"
  polyline      String   // 路径 polyline JSON
  distanceMeters Float
  durationSeconds Int
  cachedAt      DateTime @default(now())
  expiresAt     DateTime

  @@unique([originLat, originLng, destLat, destLng, routeType])
}
```

### 4.2 迁移策略

**原则：数据模型结构变更在 `feature-data-model` 阶段一次性完成，禁止下游阶段修改 schema。**

迁移步骤：

```bash
# 步骤 1：在阿里云 RDS PostgreSQL 创建目标库
# 步骤 2：使用 pg_dump 从 Supabase 导出 schema + 数据
pg_dump "postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres" \
  --schema-only --no-owner --no-privileges > schema.sql

# 步骤 3：在阿里云 RDS 执行 schema（含新增字段）
psql "postgresql://user:pass@pgm-xxx.pg.rds.aliyuncs.com:5432/rcd_db" < schema.sql

# 步骤 4：使用 Prisma migrate dev 应用新增字段（dry-run 验证后）
npx prisma migrate dev --name add_production_fields

# 步骤 5：数据迁移（pg_dump 数据部分）
pg_dump "postgresql://..." --data-only --table=User --table=Store ... > data.sql
psql "postgresql://..." < data.sql

# 步骤 6：验证
# - 检查所有表行数一致
# - 检查所有外键关系完整
# - 检查枚举值与代码一致
```

---

## 5. Web端生产级架构

### 5.1 部署架构图

```
                   ┌─────────────┐
                   │   CDN/OSS   │  静态资源 + 前端页面
                   └──────┬──────┘
                          │
┌─────────┐    ┌─────────▼─────────┐    ┌──────────────────┐
│ 阿里云   │    │  Next.js 14       │    │  WebSocket 服务   │
│ SLB     │───▶│  (ECS/K8s 多实例)  │    │  (Socket.IO)     │
│ 负载均衡 │    │  - App Router     │    │  - 位置广播       │
└─────────┘    │  - API Routes     │    │  - 派单通知       │
               │  - SSR 页面       │    │  - 状态同步       │
               └────────┬──────────┘    └────────┬─────────┘
                        │                        │
               ┌────────▼──────────┐             │
               │  Redis Cluster    │◄────────────┘
               │  - GeoHash 位置   │
               │  - Session        │
               │  - 路径缓存       │
               │  - 令牌桶限流     │
               └────────┬──────────┘
                        │
               ┌────────▼──────────┐
               │  阿里云 RDS PG    │
               │  - pgBouncer      │
               │  - 主库+只读副本   │
               └───────────────────┘
```

### 5.2 WebSocket 实时位置同步架构

```
微信小程序(司机端)
    │
    │ wx.onLocationChange(cb)
    │ 每3-5秒上报一次位置
    ▼
POST /api/driver/location/report
    │
    │ 写入 Redis GeoHash
    │ (GEOADD drivers <lng> <lat> <driverId>)
    │
    ▼
Socket.IO → 广播到所有 Web 端连接
    │
    │ driver_location_update 事件
    │ { driverId, lat, lng, updatedAt, speed, direction }
    ▼
Web 端 (调度员)
    │
    │ 增量更新对应 Marker 位置
    │ 平滑过渡动画（requestAnimationFrame）
    ▼
地图上司机图标实时移动
```

### 5.3 关键性能优化

| 优化项 | 方案 |
|--------|------|
| **地图渲染** | 视口裁剪（只加载可视区域订单/司机）；点聚合（100+ markers）；增量更新（单个 marker 位置变化不重绘全部） |
| **API 缓存** | Redis 缓存：路径规划结果（2小时）；反向地理编码（24小时）；司机当前位置（实时） |
| **数据库** | pgBouncer 连接池（事务模式）；只读查询走只读副本；`SELECT` 只取必要字段 |
| **限流** | API Route 层：`/api/import` 50次/分钟；`/api/dispatch/recommend` 30次/分钟；`/api/driver/location` 不限流（走 WebSocket） |

---

## 6. 微信小程序司机端方案

### 6.1 技术选型

| 选项 | 推荐度 | 理由 |
|------|--------|------|
| **原生微信小程序** | ⭐⭐⭐⭐⭐ **推荐** | 高德地图支持最好，定位API最完整，性能最优 |
| UniApp | ⭐⭐⭐ | 跨端方便但地图性能差，定位API封装不够底层 |
| Taro | ⭐⭐⭐ | 类似 UniApp，React 技术栈 |

**推荐原生微信小程序**，理由：
- 高德地图微信小程序 SDK 官方支持
- `wx.onLocationChange` / `wx.startLocationUpdateBackground` 等底层 API 直接可用
- 审核路径清晰
- 包大小2MB限制下，原生最小

### 6.2 页面结构（最小可用版本）

```
司机端小程序页面：
├── pages/login/          # 登录页（微信授权 + 绑定司机账号）
├── pages/tasks/          # 任务列表（待接单 + 进行中）
│   ├── 订单列表（按距离排序）
│   ├── 搜索工单（订单号搜索）
│   └── 下拉刷新
├── pages/task-detail/    # 任务详情
│   ├── 取车/还车地址（含距离、ETA）
│   ├── 客户信息
│   ├── 认领工单按钮
│   └── 一键导航按钮（调起高德/微信地图）
├── pages/navigation/     # 导航页（嵌入微信地图组件）
│   ├── 起点→终点路径显示
│   ├── 实时 ETA 更新
│   └── 到达确认按钮
├── pages/profile/        # 个人中心
│   ├── 今日完成数
│   ├── 在线/忙碌状态切换
│   └── 历史订单
```

### 6.3 核心定位实现

```javascript
// 1. 启动持续定位
wx.startLocationUpdateBackground({
  type: 'gcj02',
  success: () => {
    console.log('后台定位已启动');
  },
  fail: (err) => {
    // iOS 可能因权限不足失败，降级为前台定位
    wx.startLocationUpdate({ type: 'gcj02' });
  }
});

// 2. 监听位置变化
let lastReportTime = 0;
wx.onLocationChange((res) => {
  const now = Date.now();
  if (now - lastReportTime < 3000) return; // 3秒上报一次
  lastReportTime = now;

  // 上报到后端
  wx.request({
    url: 'https://api.your-domain.com/api/driver/location/report',
    method: 'POST',
    header: { Authorization: `Bearer ${token}` },
    data: {
      lat: res.latitude,
      lng: res.longitude,
      speed: res.speed,
      accuracy: res.accuracy,
      direction: res.direction || null,
    }
  });
});

// 3. 切后台时降低上报频率
wx.onAppHide(() => {
  clearInterval(reportTimer);
  reportTimer = setInterval(reportLocation, 10000); // 10秒一次
});

// 4. 回到前台恢复频率
wx.onAppShow(() => {
  clearInterval(reportTimer);
  reportTimer = setInterval(reportLocation, 3000); // 恢复3秒一次
});
```

### 6.4 小程序端高德地图集成

```javascript
// app.json 引入高德小程序 SDK 插件
{
  "plugins": {
    "amap-wx": {
      "version": "2.0.0",
      "provider": "wx65cc950f51d7e8d9"
    }
  }
}

// 路径规划
const amapPlugin = requirePlugin('amap-wx');
const amap = new amapPlugin.AMapWX({ key: 'YOUR_JS_KEY' });

// 获取骑行路线
amap.getRidingRoute({
  origin: '116.48128,39.98979',
  destination: '116.47457,39.99402',
  success: (data) => {
    // data.paths[0] 包含距离、时长、路径点
    const { distance, duration, steps } = data.paths[0];
  }
});

// 一键导航（调起微信地图/高德地图）
wx.openLocation({
  latitude: destLat,
  longitude: destLng,
  name: '目的地名称',
  address: '目的地地址',
  scale: 15
});
```

---

## 7. 高德地图集成方案

### 7.1 API 调用矩阵

| 场景 | SDK/API | 位置 | 说明 |
|------|---------|------|------|
| Web 地图渲染 | JS API 2.0 Loader | 前端 `lib/map/` | NEXT_PUBLIC_AMAP_JS_KEY |
| 地址→坐标 | 地理编码 API | 后端 `lib/import/services/geocode.ts` | 已有实现 |
| 路径规划（ETA） | 路径规划 API | 后端 `lib/dispatch/eta.ts` | 已有实现 |
| **司机→订单 ETA** | 骑行/驾车路径规划 | **后端新增** `lib/routing/eta.ts` | 实时计算司机到订单的预计时间 |
| **最优路径规划** | 路径规划 API | **后端新增** `lib/routing/planner.ts` | 多站点路径优化 |
| **轨迹上传** | 鹰眼轨迹服务 | **后端新增** `lib/adapters/amap-trace.ts` | 可选，替代自建轨迹存储 |
| 小程序地图 | 小程序 SDK 插件 | 微信小程序端 | 导航 + 路径展示 |

### 7.2 ETA 与路径规划实现

```typescript
// src/lib/routing/eta.ts — 生产级实现

import { redis } from '@/lib/redis';

interface EtaRequest {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode?: 'driving' | 'riding' | 'walking';
}

interface EtaResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: Array<[number, number]>;
  trafficDurationSeconds?: number; // 考虑实时路况
}

export async function computeEta(req: EtaRequest): Promise<EtaResult> {
  // 1. 查缓存
  const cacheKey = `eta:${req.originLat}:${req.originLng}:${req.destLat}:${req.destLng}:${req.mode || 'driving'}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 2. 调用高德路径规划 API
  const amapKey = process.env.AMAP_SERVER_KEY!;
  const mode = req.mode || 'driving';
  const url = `https://restapi.amap.com/v4/direction/${mode}?origin=${req.originLng},${req.originLat}&destination=${req.destLng},${req.destLat}&key=${amapKey}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.errcode !== 0) {
    throw new Error(`AMAP routing error: ${data.errcode} ${data.errmsg}`);
  }

  const path = data.data.paths[0];
  const result: EtaResult = {
    distanceMeters: parseInt(path.distance),
    durationSeconds: parseInt(path.duration),
    polyline: decodeAmapPolyline(path.steps.flatMap((s: any) => s.polyline)),
    trafficDurationSeconds: path.duration_traffic ? parseInt(path.duration_traffic) : undefined,
  };

  // 3. 写入缓存（2小时）
  await redis.setex(cacheKey, 7200, JSON.stringify(result));

  return result;
}

// 高德 polyline 解码
function decodeAmapPolyline(steps: any[]): Array<[number, number]> {
  // 高德新版 API (v4) 返回的 steps 中 polyline 是坐标字符串
  // 格式："lng1,lat1;lng2,lat2;..."
  const allPoints: Array<[number, number]> = [];
  for (const step of steps) {
    const polylineStr = typeof step.polyline === 'string'
      ? step.polyline
      : step.polyline?.polyline || '';
    const coords = polylineStr.split(';').filter(Boolean);
    for (const coord of coords) {
      const [lng, lat] = coord.split(',').map(Number);
      allPoints.push([lng, lat]);
    }
  }
  return allPoints;
}
```

### 7.3 司机到订单的批量 ETA 计算（调度核心）

```typescript
// src/lib/dispatch/eta.ts — 批量计算 Top N 司机的 ETA

export async function computeBatchEta(
  drivers: Array<{ id: string; lat: number; lng: number }>,
  orderPickup: { lat: number; lng: number },
  mode: 'driving' | 'riding' = 'driving'
): Promise<Map<string, EtaResult>> {
  // 策略：先 Haversine 直线距离预筛 Top 10，再对 Top 10 调高德 API
  // 这样 50 个司机只需调 10 次 API，而非 50 次

  const sorted = drivers
    .map(d => ({
      ...d,
      distance: haversine(d.lat, d.lng, orderPickup.lat, orderPickup.lng),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10); // 只计算最近的 10 个

  const results = new Map<string, EtaResult>();
  await Promise.all(
    sorted.map(async (d) => {
      try {
        const eta = await computeEta({
          originLat: d.lat,
          originLng: d.lng,
          destLat: orderPickup.lat,
          destLng: orderPickup.lng,
          mode,
        });
        results.set(d.id, eta);
      } catch {
        // ETA 失败时用直线距离 × 1.5 估算
        results.set(d.id, {
          distanceMeters: d.distance,
          durationSeconds: (d.distance / 500) * 60, // 假设 500m/min
          polyline: [],
        });
      }
    })
  );

  return results;
}
```

---

## 8. 基础设施升级路径

### 8.1 云服务选型

| 组件 | 当前 Demo | 升级到生产级 | 月度估算（小规模） |
|------|-----------|-------------|-------------------|
| 数据库 | Supabase (免费) | 阿里云 RDS PostgreSQL 2C4G | ¥400-600 |
| 缓存 | 无 | 阿里云 Redis 标准版 1G | ¥200-300 |
| 计算 | 单机 dev server | 阿里云 ECS 2C4G ×2 或 SAE/K8s | ¥500-1000 |
| 静态资源 | 无 | 阿里云 OSS + CDN | ¥50-100 |
| 域名 + SSL | 无 | 阿里云域名 + 免费 SSL | ¥60/年 |
| 高德 API | 免费额度内 | 根据调用量（预估 ¥200-500/月） | ¥200-500 |
| 微信小程序 | 无 | 认证费 ¥300/年 | ¥300/年 |
| **合计** | ¥0 | — | **¥1,700-2,900/月** |

### 8.2 数据库迁移清单

- [ ] 阿里云 RDS PostgreSQL 实例创建
- [ ] 数据库 `rcd_production` 创建
- [ ] PostGIS 扩展启用
- [ ] pgBouncer 配置（事务池化模式）
- [ ] 使用阿里云 Supabase 迁移工具或 pg_dump 迁移数据
- [ ] 执行 Prisma migrate 应用新字段
- [ ] 数据完整性验证（行数对比 + 外键检查）
- [ ] 应用层连接串切换 → `.env.production`

---

## 9. 阶段路线图

### 概述

现有 1-11 阶段均为 Demo 时期定义，部分已完成。以下为新定义的**生产级升级阶段**，编号接续原有阶段。**遵循 CLAUDE.md 中的隔离原则和提交格式不变。**

```
已完成: 1.docs-prd → 2.repo-bootstrap → 3.data-model → 4.order-import
       → 5.map-board → 6.admin-workflow → 7.dispatch-rule-v1
       → 8.logging-observe → 9.integration-adapter → 10.driver-workflow
待完成: 11.stabilization

新增:
12.production-infra → 13.data-model-v2 → 14.realtime-engine
→ 15.wechat-miniapp → 16.dispatch-engine-v2 → 17.production-stabilization
```

### 12. production-infra — 生产基础设施

- **目标**：阿里云 RDS + Redis + 生产部署环境就绪
- **允许**：`.env.production`、`docker-compose.prod.yml`、`nginx/`、部署脚本
- **禁止**：修改业务代码、prisma schema
- **验收**：
  - [ ] 阿里云 RDS 可连接，PostGIS 生效
  - [ ] Redis 可连接，`PING` 通过
  - [ ] pgBouncer 连接池正常工作
  - [ ] `pnpm build` 在容器中成功
  - [ ] 静态资源走 CDN/OSS

### 13. data-model-v2 — 数据模型生产升级

- **目标**：迁移到阿里云 RDS + 应用 v2 schema 变更
- **依赖**：production-infra 退出
- **允许**：`prisma/schema.prisma`、`prisma/migrations/`、`prisma/seed.ts`
- **禁止**：修改任何页面、API、业务逻辑
- **验收**：
  - [ ] 所有新增字段迁移成功（Driver 位置字段、Order ETA 字段、DriverLocationLog 表、RouteCache 表）
  - [ ] Supabase → 阿里云数据全量迁移完成，行数一致
  - [ ] `npx prisma studio` 可在阿里云数据库正常浏览
  - [ ] seed 数据在阿里云可正常写入

### 14. realtime-engine — 实时通信引擎

- **目标**：WebSocket 位置同步 + 派单推送 + 状态广播
- **依赖**：data-model-v2 退出
- **允许**：`lib/realtime/`（全新）、独立 WebSocket 服务、`lib/middleware/rate-limit.ts`
- **禁止**：修改业务页面结构、prisma schema
- **验收**：
  - [ ] 司机位置每 3-5 秒可达 Web 端地图（P95 < 5s）
  - [ ] 派单通知实时推送到司机端
  - [ ] WebSocket 断线自动重连
  - [ ] API 限流中间件生效
  - [ ] 100 并发 WebSocket 连接稳定（压测验证）

### 15. wechat-miniapp — 微信小程序司机端

- **目标**：司机定位→派单通知→认领工单→一键导航 完整闭环
- **依赖**：realtime-engine 退出
- **允许**：`miniapp/`（全新独立目录，不在 src/ 下）、`app/api/driver/` 扩展现有接口
- **禁止**：修改 Web 端页面结构、prisma schema、调度引擎
- **验收**：
  - [ ] 司机登录（微信授权 + 账号绑定）
  - [ ] 实时定位上报（3-5秒间隔）
  - [ ] 收到派单推送通知
  - [ ] 工单搜索（按订单号）
  - [ ] 认领/拒绝工单
  - [ ] 一键导航（调起微信地图/高德地图）
  - [ ] Android 真机测试通过

### 16. dispatch-engine-v2 — 调度引擎升级

- **目标**：加权评分模型 + 批量 ETA 计算 + 多策略切换
- **依赖**：realtime-engine 退出
- **允许**：`lib/dispatch/`（扩展现有文件）、`lib/routing/`（全新）
- **禁止**：修改 Web 页面结构、prisma schema
- **验收**：
  - [ ] `computeDriverScore()` 加权评分生效
  - [ ] 批量 ETA 计算（先 Haversine 预筛 Top 10，再调高德 API）
  - [ ] ETA ≥ 120 分钟标记 MANUAL
  - [ ] 调度策略可配置（距离优先 / 负载优先 / 综合评分）
  - [ ] confirm 使用事务 + 分布式锁防并发重复派单

### 17. production-stabilization — 生产收尾

- **目标**：全链路压测 + bug 修复 + 运行手册 + 演示脚本
- **依赖**：15、16 退出
- **允许**：影响生产使用的 bug 修复、`docs/runbook-production.md`、压测脚本
- **禁止**：新功能、大幅度重构
- **验收**：
  - [ ] 50 并发用户 + 100 司机 + 500 订单场景无报错
  - [ ] WebSocket 100 连接稳定运行 1 小时
  - [ ] 端到端演示脚本（导入→派单→司机接单→导航→完成）无报错走通
  - [ ] 生产运行手册完成（部署/监控/回滚/备份）

---

## 10. 验收标准

### 10.1 核心功能验收

```
场景：调度员导入 50 个订单 → 地图显示订单分布 → 调度员查看推荐司机
     → 派单给最优司机 → 司机微信小程序收到通知 → 认领工单
     → 一键导航 → 到达完成 → 订单状态变为 COMPLETED

每步通过条件：
✅ 订单导入：50个全部入库，坐标正确
✅ 地图展示：50个订单 + 10个司机点位在地图上正确显示，按状态着色
✅ 推荐司机：Top 3 司机含推荐理由（距离、ETA、负载率）
✅ 派单操作：点击派单 → 订单状态 ASSIGNED → 操作日志记录
✅ 司机接单：小程序收到推送 → 认领 → 状态 ACCEPTED → 开始导航
✅ 路径规划：高德真实路径显示，ETA < 预期时间
✅ 实时位置：Web 地图上司机图标实时移动
✅ 任务完成：司机到达 → 确认完成 → 状态 COMPLETED
```

### 10.2 非功能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 位置同步延迟 | P95 < 5 秒 | WebSocket 消息时间戳对比 |
| 地图首屏渲染 | < 3 秒 | Lighthouse Performance |
| API 响应时间 (P95) | < 500ms | Pino 日志 + Grafana |
| WebSocket 连接稳定率 | > 99.5% | 1小时压测断连次数 |
| 数据库迁移零丢失 | 100% 行数一致 | 迁移后逐表 COUNT 对比 |
| 微信小程序包大小 | < 2MB | 开发者工具分析 |

---

## 附录

### A. 参考开源项目汇总

| 项目 | GitHub | 许可 | 参考价值 |
|------|--------|------|----------|
| Fleetbase | [fleetbase/fleetbase](https://github.com/fleetbase/fleetbase) | AGPL-3.0 | 架构设计、模块划分、实时追踪 |
| TMS-Logistics | [Sigma429/TMS-Logistics](https://github.com/Sigma429/TMS-Logistics) | 开源 | 微服务架构、智能任务分配 |
| 万岳外卖 | [WanyueKJ/Takeaway-Distribution](https://github.com/WanyueKJ/Takeaway-Distribution) | 开源 | 调度算法、骑手抢单、多运力模式 |
| Mobius | [mobius-scheduler/mobius](https://github.com/mobius-scheduler/mobius) | MIT | 调度算法核心、公平性-吞吐量权衡 |
| Realtime Dispatch | [robert-nguyenn/realtime_dispatch_system](https://github.com/robert-nguyenn/realtime_dispatch_system) | 开源 | 高并发架构、GeoHash索引 |
| FleetMind MCP | [Hugging Face](https://huggingface.co/spaces/MCP-1st-Birthday/fleetmind-dispatch-ai) | 开源 | AI智能派单 |
| TrackNex | [yashitiwary/delivery-tracking](https://github.com/yashitiwary/delivery-tracking) | 开源 | Next.js 实时追踪参考 |

### B. 关键文档链接

- [阿里云 Supabase 迁移工具官方文档](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/supabase-migration-tool)
- [高德地图 Web JS API 2.0](https://lbs.amap.com/api/jsapi-v2/summary)
- [高德地图微信小程序 SDK](https://lbs.amap.com/api/wx/summary)
- [高德鹰眼轨迹服务](https://lbs.amap.com/api/track/lieying/summary)
- [微信小程序位置 API](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.startLocationUpdateBackground.html)
- [微信小程序地图组件](https://developers.weixin.qq.com/miniprogram/dev/component/map.html)
- [Fleetbase 官方文档](https://docs.fleetbase.io/)
- [Prisma pgBouncer 配置](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management/configure-pg-bouncer)

---

_本方案遵循项目 CLAUDE.md 中的所有全局铁律：阶段隔离、提交格式、命名规范、工具分工。所有新增阶段不得修改上游依赖、不得提前实现下游功能。_

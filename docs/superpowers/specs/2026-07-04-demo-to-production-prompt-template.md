# Demo原型 → 生产级应用 升级实施 Prompt 模板

版本：2026-07-04
用途：将此 prompt 提供给 LLM（Claude Code / Trae GPT-5.4 / 其他），按阶段逐一执行升级方案。
使用方法：每个阶段开始时，将对应阶段的 prompt 复制给 LLM，一次只执行一个阶段。

---

## 使用说明

1. 每个阶段是一个独立的 prompt 块
2. 严格按顺序执行，不可跳阶段
3. 每个阶段完成后必须通过验收标准才能进入下一阶段
4. 所有命令在对应的 `feature-*` worktree 中执行
5. 遵守项目根目录 `CLAUDE.md` 中的所有全局铁律

---

## 通用约束（每个阶段 prompt 都需要包含）

```markdown
## 通用约束

你正在执行人车单调度系统（RCD Dispatch）的生产级升级。你必须遵守以下所有规则：

### 技术栈锁定
- 全栈：Next.js 14 (App Router) + TypeScript
- UI：Tailwind CSS + shadcn/ui
- 数据库：PostgreSQL + Prisma ORM
- 地图：高德 API（服务端 Key：AMAP_SERVER_KEY；前端 Key：NEXT_PUBLIC_AMAP_JS_KEY）
- 日志：Pino（stdout 输出）
- 测试：Vitest
- 包管理器：pnpm@10.11.0，禁止使用 npm/yarn

### API 规范
- 所有 API Route 必须使用 `lib/api-response.ts` 的 `ok()` / `fail()` 返回
- 响应头必须带 `X-Trace-Id`
- 禁止裸 `NextResponse.json({ ... })`

### 命名规范
- 文件命名：kebab-case
- 组件命名：PascalCase
- 变量/函数：camelCase
- 枚举值：UPPER_SNAKE_CASE

### 阶段隔离原则
- 只能修改本阶段允许范围内的文件
- 禁止修改上游依赖
- 禁止提前实现下游功能

### 提交格式
每条提交说明必须写四点：
1. 做了什么
2. 没做什么
3. 验收结果
4. 退出条件

### 项目参考文件
- 全局铁律：项目根目录 `CLAUDE.md`
- Demo UI/UX 规范：`docs/demo-v12-ui-ux-spec.md`
- Demo API 契约：`docs/demo-v12-api-contract.md`
- 升级方案：`docs/superpowers/specs/2026-07-04-demo-to-production-upgrade-plan.md`

### 目标
Web端 + 手机端能真实同步人员位置。
阿里云数据库能真实映射订单位置与相关信息字段。
高德API能真实调用人员与订单之间的位置关系，提供预计到达、时间测算、路径方案。
```

---

## 阶段 12：production-infra — 生产基础设施

```markdown
## 任务：阶段 12 — 生产基础设施就绪

### 背景
Demo 阶段所有服务运行在单机 dev server，数据库托管在 Supabase。
现在需要将基础设施迁移到阿里云，为生产部署做好准备。

### 目标
1. 阿里云 RDS PostgreSQL 实例创建并配置
2. 阿里云 Redis 实例创建并配置
3. 生产环境变量配置
4. Docker Compose 生产部署文件

### 允许修改的范围
- `.env.production`（新建）
- `docker-compose.prod.yml`（新建）
- `nginx/nginx.conf`（新建）
- `scripts/deploy.sh`（新建）
- `scripts/migrate-db.sh`（新建）

### 禁止修改
- 任何 `.ts` / `.tsx` / `.prisma` 文件
- 任何业务代码
- `prisma/schema.prisma` 结构

### 具体任务

#### 12.1 阿里云 RDS PostgreSQL 配置
1. 创建阿里云 RDS PostgreSQL 实例（推荐 2C4G，存储 50GB）
2. 启用 PostGIS 扩展：`CREATE EXTENSION IF NOT EXISTS postgis;`
3. 配置白名单（本地IP + 服务器IP）
4. 创建数据库 `rcd_production`
5. 配置 pgBouncer（事务池化模式）

#### 12.2 阿里云 Redis 配置
1. 创建 Redis 标准版实例（推荐 1GB）
2. 配置白名单
3. 验证连接：`redis-cli -h <host> -p <port> -a <password> PING`

#### 12.3 环境变量文件 (.env.production)
```
DATABASE_URL=postgresql://user:pass@pgm-xxx.pg.rds.aliyuncs.com:5432/rcd_production?pgbouncer=true
SHADOW_DATABASE_URL=postgresql://user:pass@pgm-xxx.pg.rds.aliyuncs.com:5432/rcd_shadow?pgbouncer=true
REDIS_URL=redis://:password@r-xxx.redis.rds.aliyuncs.com:6379/0
NEXTAUTH_SECRET=<random-64-char>
AMAP_SERVER_KEY=<your-server-key>
NEXT_PUBLIC_AMAP_JS_KEY=<your-js-key>
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws
```

#### 12.4 Docker 部署文件
- 创建 `docker-compose.prod.yml`：Next.js 应用 + 独立 WebSocket 服务
- 创建 `nginx/nginx.conf`：反向代理 + WebSocket 升级 + SSL 终止
- 创建部署脚本 `scripts/deploy.sh`

### 验收标准
- [ ] 阿里云 RDS 可连接，PostGIS 生效
- [ ] 阿里云 Redis 可连接，`PING` 返回 `PONG`
- [ ] pgBouncer 连接池正常工作
- [ ] `pnpm build` 在容器中成功
- [ ] `curl http://localhost:3000/api/health` 返回 200

### 参考
- 升级方案第 8 节：基础设施升级路径
- 升级方案第 5.1 节：部署架构图
- [阿里云 RDS PostgreSQL 文档](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/)
- [Prisma pgBouncer 配置](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management/configure-pg-bouncer)
```

---

## 阶段 13：data-model-v2 — 数据模型生产升级

```markdown
## 任务：阶段 13 — 数据模型生产升级

### 背景
Demo 阶段数据模型缺少生产所需字段（司机实时位置、ETA、微信绑定、轨迹记录等）。
需要升级 schema 并将数据从 Supabase 迁移到阿里云 RDS。

### 目标
1. Prisma Schema 新增生产字段
2. Supabase → 阿里云数据全量迁移
3. 数据完整性验证

### 允许修改的范围
- `prisma/schema.prisma`（仅新增字段和表）
- `prisma/migrations/`（新迁移文件）
- `prisma/seed.ts`（更新种子数据）
- `scripts/migrate-db.sh`（更新）

### 禁止修改
- 任何页面 `.tsx` 文件
- 任何 API Route
- 任何 `lib/` 下的业务逻辑
- `src/` 目录结构

### 具体任务

#### 13.1 Schema 新增字段

##### Driver 表新增
```prisma
model Driver {
  // === 保留所有现有字段 ===

  // 新增：实时位置
  currentLat         Float?              // 当前纬度
  currentLng         Float?              // 当前经度
  locationUpdatedAt  DateTime?           // 位置更新时间
  locationSource     String?             // "WECHAT_MINI" | "GPS_DEVICE" | "MANUAL"

  // 新增：调度统计
  totalCompleted     Int      @default(0) // 累计完成订单
  onTimeRate         Float?              // 准时率 (0-1)
  avgCompleteMinutes Float?              // 平均完成时长（分钟）

  // 新增：微信小程序绑定
  wechatOpenId       String?  @unique    // 微信 OpenID
  wechatUnionId      String?             // 微信 UnionID
  wechatNickname     String?             // 微信昵称
  wechatAvatarUrl    String?             // 微信头像
}
```

##### Order 表新增
```prisma
model Order {
  // === 保留所有现有字段 ===

  // 新增：ETA 与路径
  estimatedArrivalMinutes Int?           // 预计到达时间（分钟）
  routePolyline            String?       // 路径规划 polyline（JSON 字符串）
  actualDistanceMeters     Float?        // 实际行驶距离

  // 新增：外部系统映射
  externalOrderId          String?       // 外部系统订单ID
  externalSource           String?       // "HELLO" | "MANUAL" | "API"

  // 新增：联系人信息
  customerName             String?       // 客户姓名
  customerPhone            String?       // 客户电话
  customerNotes            String?       // 客户备注
}
```

##### 全新表
```prisma
// 司机位置上报记录（轨迹回放）
model DriverLocationLog {
  id          String   @id @default(cuid())
  driverId    String
  lat         Float
  lng         Float
  accuracy    Float?   // GPS 精度（米）
  speed       Float?   // 速度（km/h）
  direction   Float?   // 方向角（度）
  source      String   @default("WECHAT_MINI")
  createdAt   DateTime @default(now())

  @@index([driverId, createdAt])
  @@index([createdAt])
}

// 高德路径规划缓存
model RouteCache {
  id              String   @id @default(cuid())
  originLat       Float
  originLng       Float
  destLat         Float
  destLng         Float
  routeType       String   @default("DRIVING")
  polyline        String
  distanceMeters  Float
  durationSeconds Int
  cachedAt        DateTime @default(now())
  expiresAt       DateTime

  @@unique([originLat, originLng, destLat, destLng, routeType])
}
```

#### 13.2 数据迁移
1. 从 Supabase 导出数据：`pg_dump --data-only`
2. 在阿里云 RDS 执行 Prisma migrate
3. 导入数据到阿里云
4. 逐表验证行数一致

#### 13.3 种子数据更新
更新 `prisma/seed.ts`，添加新字段的示例值。

### 验收标准
- [ ] `npx prisma migrate dev` 无报错
- [ ] 所有新增字段和表在数据库中可见
- [ ] Supabase → 阿里云数据全量迁移完成
- [ ] 逐表 COUNT 对比：行数一致
- [ ] 种子数据可正常写入
- [ ] `npx prisma studio` 在阿里云数据库正常浏览
- [ ] 所有现有枚举值不变（`OrderStatus`、`DriverStatus` 等）

### 参考
- 升级方案第 4 节：数据模型升级方案
- 现有 `prisma/schema.prisma` 在 `feature-admin-workflow/prisma/schema.prisma`
- [阿里云 Supabase 迁移工具](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/supabase-migration-tool)
```

---

## 阶段 14：realtime-engine — 实时通信引擎

```markdown
## 任务：阶段 14 — 实时通信引擎

### 背景
Demo 阶段地图数据通过 HTTP 轮询刷新，没有实时推送能力。
生产级需要 WebSocket 实现司机位置实时同步、派单实时推送、状态实时广播。

### 目标
1. 独立 WebSocket 服务（Socket.IO）
2. Redis GeoHash 司机位置存储
3. 司机位置上报 API
4. 前端 WebSocket 集成（地图实时更新）
5. 派单通知推送
6. API 限流中间件

### 允许修改的范围
- `lib/realtime/`（全新）
- `server/ws-server.ts`（全新 WebSocket 服务入口）
- `app/api/driver/location/route.ts`（扩展现有，增加位置上报）
- `lib/middleware/rate-limit.ts`（全新）
- `app/admin/map/components/map-board.tsx`（增加 WS 连接逻辑）
- `lib/redis.ts`（全新 Redis 客户端）
- `package.json`（新增 socket.io 等依赖）

### 禁止修改
- prisma schema 结构
- admin-workflow 页面结构
- 调度引擎逻辑

### 具体任务

#### 14.1 Redis 客户端
```typescript
// lib/redis.ts
import Redis from 'ioredis';
export const redis = new Redis(process.env.REDIS_URL!);
export const publisher = new Redis(process.env.REDIS_URL!);
export const subscriber = new Redis(process.env.REDIS_URL!);
```

#### 14.2 位置上报 API
```
POST /api/driver/location/report
Body: { lat: number, lng: number, speed?: number, accuracy?: number, direction?: number }
Auth: Bearer <driver_token>

操作：
1. 验证司机身份
2. 写入 Redis GeoHash: GEOADD driver_locations <lng> <lat> <driverId>
3. 写入 PostgreSQL: DriverLocationLog
4. 发布 Redis Pub/Sub: driver:location_update
5. WebSocket 广播给 Web 端
```

#### 14.3 WebSocket 服务
```typescript
// server/ws-server.ts
// 独立 Socket.IO 服务
// 监听 Redis Pub/Sub 频道
// 广播事件：driver_location_update, order_status_change, dispatch_notification
```

#### 14.4 前端集成
```typescript
// lib/realtime/useSocket.ts
// Socket.IO 客户端 Hook
// 连接管理 + 自动重连
// 事件监听：driver_location_update → 更新地图 marker
```

#### 14.5 API 限流中间件
```typescript
// lib/middleware/rate-limit.ts
// Redis 令牌桶算法
// 默认：60次/分钟/IP
// 导入 API：50次/分钟
// 调度推荐：30次/分钟
```

### 验收标准
- [ ] 模拟司机位置上报，3-5 秒内在 Web 地图看到位置更新
- [ ] WebSocket 连接建立成功，心跳正常
- [ ] 派单通知推送到指定频道
- [ ] WebSocket 断线后 10 秒内自动重连
- [ ] 100 并发 WebSocket 连接稳定（使用 wrk/artillery 压测）
- [ ] 位置同步延迟 P95 < 5 秒
- [ ] API 限流中间件生效（超过阈值返回 429）
- [ ] Redis GeoHash 位置查询可用

### 参考
- 升级方案第 5.2 节：WebSocket 实时位置同步架构
- [Socket.IO 文档](https://socket.io/docs/v4/)
- [Redis Geo 命令](https://redis.io/commands/geoadd/)
```

---

## 阶段 15：wechat-miniapp — 微信小程序司机端

```markdown
## 任务：阶段 15 — 微信小程序司机端

### 背景
Demo 阶段没有移动端，司机端仅有 API 契约层。
生产级需要一个微信小程序，实现司机实时定位、派单通知、工单搜索、认领工单、一键导航。

### 目标
1. 微信小程序项目结构搭建
2. 司机登录与微信绑定
3. 实时定位与位置上报
4. 任务列表（待接单 + 进行中）
5. 工单搜索
6. 认领/拒绝工单
7. 一键导航（调起微信地图/高德地图）
8. 派单推送通知

### 允许修改的范围
- `miniapp/`（全新独立目录，不在 src/ 下）
- `app/api/driver/auth/`（扩展现有，增加微信登录）
- `app/api/driver/location/route.ts`（扩展，增加持续上报）
- `app/api/driver/orders/`（扩展，增加任务列表）

### 禁止修改
- Web 端页面结构
- prisma schema
- 调度引擎
- 实时通信引擎

### 具体任务

#### 15.1 小程序项目结构
```
miniapp/
├── app.js
├── app.json
├── app.wxss
├── pages/
│   ├── login/           # 登录（微信授权 + 司机绑定）
│   ├── tasks/           # 任务列表
│   ├── task-detail/     # 任务详情（认领/拒绝/导航）
│   ├── navigation/      # 导航页（嵌入地图）
│   └── profile/         # 个人中心
├── components/
│   ├── order-card/      # 订单卡片组件
│   └── status-badge/    # 状态标签组件
├── utils/
│   ├── api.js           # HTTP 请求封装
│   ├── auth.js          # Token 管理
│   ├── location.js      # 定位管理
│   └── ws.js            # WebSocket 连接管理
└── project.config.json
```

#### 15.2 核心页面功能

##### 登录页 (pages/login)
- `wx.login()` 获取 code
- 后端用 code 换取 openId
- 绑定司机账号（输入工号 / 手机号）
- 存储 JWT token

##### 任务列表 (pages/tasks)
- 两个 Tab：待接单 / 进行中
- 按距离排序（用当前位置算）
- 下拉刷新
- 搜索框（按订单号搜索）

##### 任务详情 (pages/task-detail)
- 取车地址 + 距离 + ETA
- 还车地址
- 客户信息（姓名、电话、备注）
- 认领按钮 / 拒绝按钮
- 一键导航按钮

##### 导航页 (pages/navigation)
- 嵌入 `<map>` 组件
- 显示起点→终点路径（polyline）
- 实时 ETA
- 到达确认按钮

#### 15.3 定位实现
参考升级方案第 6.3 节：
- `wx.startLocationUpdateBackground()` 启动后台定位
- `wx.onLocationChange()` 监听位置变化
- 每 3-5 秒上报一次
- 切后台时降频到 10 秒一次
- 回到前台恢复 3 秒一次

#### 15.4 高德地图小程序 SDK
- 安装高德小程序 SDK 插件
- 路径规划使用 `amapPlugin.getRidingRoute()` 或 `getDrivingRoute()`
- 一键导航使用 `wx.openLocation()`

#### 15.5 API 接口清单
| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/driver/auth/wechat-login` | POST | 微信 code 换 token |
| `/api/driver/auth/bind` | POST | 绑定司机账号 |
| `/api/driver/location/report` | POST | 位置上报 |
| `/api/driver/orders/pending` | GET | 待接单列表 |
| `/api/driver/orders/active` | GET | 进行中列表 |
| `/api/driver/orders/:id` | GET | 订单详情 |
| `/api/driver/orders/:id/claim` | POST | 认领工单 |
| `/api/driver/orders/:id/reject` | POST | 拒绝工单 |
| `/api/driver/orders/:id/complete` | POST | 完成工单 |
| `/api/driver/orders/search?q=` | GET | 搜索工单 |

### 验收标准
- [ ] 司机微信授权登录成功
- [ ] 实时定位上报 3-5 秒间隔正常工作（Android 真机）
- [ ] Web 端地图可看到司机位置实时移动
- [ ] 派单后司机端收到推送通知
- [ ] 工单搜索可查到指定订单
- [ ] 认领工单后状态流转：ASSIGNED → ACCEPTED
- [ ] 一键导航调起微信地图成功
- [ ] 侧后台定位持续工作（降低频率但不停止）
- [ ] 小程序包大小 < 2MB

### 参考
- 升级方案第 6 节：微信小程序司机端方案
- [微信小程序位置 API](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.startLocationUpdateBackground.html)
- [高德地图微信小程序 SDK](https://lbs.amap.com/api/wx/summary)
- [Fleetbase Navigator App](https://github.com/fleetbase/navigator-app)（交互参考）
```

---

## 阶段 16：dispatch-engine-v2 — 调度引擎升级

```markdown
## 任务：阶段 16 — 调度引擎升级

### 背景
Demo 阶段调度引擎使用基础规则过滤（状态 + 负载 + 距离阈值）。
生产级需要加权评分模型 + 批量 ETA 计算 + 多策略可配置。

### 目标
1. 加权评分模型（参考万岳外卖 + Mobius）
2. 批量 ETA 计算优化（Haversine 预筛 + 高德精确计算）
3. 调度策略可切换（距离优先 / 负载优先 / 综合评分）
4. 路径规划缓存
5. 调度事务防并发

### 允许修改的范围
- `lib/dispatch/engine.ts`（升级评分逻辑）
- `lib/dispatch/eta.ts`（升级批量计算）
- `lib/dispatch/types.ts`（新增类型）
- `lib/routing/`（全新，路径规划 + ETA）
- `lib/routing/cache.ts`（全新，路径缓存）
- `app/api/dispatch/recommend/route.ts`（升级，支持策略参数）

### 禁止修改
- admin-workflow 页面结构
- prisma schema
- 实时通信引擎

### 具体任务

#### 16.1 加权评分模型
```typescript
// lib/dispatch/engine.ts 升级

interface DriverScoreInput {
  driverId: string;
  distanceMeters: number;      // Haversine 直线距离
  etaSeconds: number;          // 高德路径规划时间
  currentLoad: number;         // 当前已接未完成订单数
  historyOnTimeRate: number;   // 历史准时率 (0-1)
  familiarWithArea: boolean;   // 是否常跑该区域
}

interface DriverScoreResult {
  driverId: string;
  totalScore: number;          // 0-100
  breakdown: {
    distance: number;           // 距离分
    eta: number;                // 时间分
    load: number;               // 负载分
    efficiency: number;         // 效率分
    area: number;               // 区域分
  };
  recommendation: string;      // 推荐理由
}

function computeDriverScore(input: DriverScoreInput): DriverScoreResult {
  // 权重可配置
  const weights = {
    distance: 0.20,    // 距离权重
    eta: 0.25,         // ETA 权重（最重要的因子）
    load: 0.20,        // 负载权重
    efficiency: 0.20,  // 效率权重
    area: 0.15,        // 区域权重
  };

  // 距离分：越近越高（0-100）
  const distanceScore = normalizeInverse(input.distanceMeters, 100, 50000) * 100;

  // ETA 分：时间越短越高
  const etaScore = normalizeInverse(input.etaSeconds, 60, 7200) * 100;

  // 负载分：订单越少越高
  const loadScore = normalizeInverse(input.currentLoad, 0, 10) * 100;

  // 效率分：准时率直接映射
  const efficiencyScore = input.historyOnTimeRate * 100;

  // 区域分
  const areaScore = input.familiarWithArea ? 100 : 30;

  return {
    driverId: input.driverId,
    totalScore:
      weights.distance * distanceScore +
      weights.eta * etaScore +
      weights.load * loadScore +
      weights.efficiency * efficiencyScore +
      weights.area * areaScore,
    breakdown: {
      distance: distanceScore,
      eta: etaScore,
      load: loadScore,
      efficiency: efficiencyScore,
      area: areaScore,
    },
    recommendation: generateRecommendation(input, etaScore, efficiencyScore),
  };
}
```

#### 16.2 批量 ETA 计算
参考升级方案第 7.3 节：
1. Haversine 直线距离预筛 → Top 10
2. 对 Top 10 调高德路径规划 API
3. 非 Top 10 用直线距离估算
4. 结果写入 RouteCache 表 + Redis 缓存

#### 16.3 调度策略配置
```typescript
// lib/dispatch/types.ts 新增
export type DispatchStrategy = 'DISTANCE_FIRST' | 'LOAD_FIRST' | 'BALANCED';

export interface DispatchConfig {
  strategy: DispatchStrategy;
  maxDriversToEvaluate: number;  // 批量 ETA 计算的司机数
  etoManualThreshold: number;    // ETA 超过此值标记 MANUAL（默认 120 分钟）
  weights: {
    distance: number;
    eta: number;
    load: number;
    efficiency: number;
    area: number;
  };
}
```

#### 16.4 路径规划缓存
```typescript
// lib/routing/cache.ts
// 两级缓存：Redis（热，2小时） + PostgreSQL RouteCache 表（冷，24小时）
// 缓存 Key：${originLat}:${originLng}:${destLat}:${destLng}:${routeType}
```

#### 16.5 防并发重复派单
```typescript
// lib/dispatch/confirm.ts 升级
// 使用 Prisma 事务 + Interactive Transactions
// 加锁：SELECT ... FOR UPDATE SKIP LOCKED
// 事务中：检查订单状态 → 创建 assignment → 更新订单状态 → 写操作日志
```

### 验收标准
- [ ] `computeDriverScore()` 返回 0-100 的加权评分
- [ ] Top N 推荐含评分明细和推荐理由
- [ ] 批量 ETA：50 个司机只调 ~10 次高德 API
- [ ] ETA ≥ 120 分钟标记 MANUAL
- [ ] confirm 使用事务 + 锁，并发测试无重复派单
- [ ] 调度策略可切换（DISTANCE_FIRST / LOAD_FIRST / BALANCED）
- [ ] 路径规划缓存命中率 > 70%（同路线重复请求）
- [ ] Vitest 单元测试覆盖评分模型和 confirm 事务
- [ ] 调度耗时 < 2 秒（50 司机 + 1 订单场景）

### 参考
- 升级方案第 7.3 节：批量 ETA 计算
- 万岳外卖加权评分模型
- [高德路径规划 API v4](https://lbs.amap.com/api/webservice/guide/api/newroute)
```

---

## 阶段 17：production-stabilization — 生产收尾

```markdown
## 任务：阶段 17 — 生产收尾

### 背景
所有核心功能已实现。现在需要全链路验证、压测、修复、编写运行手册。

### 目标
1. 全链路压测
2. Bug 修复
3. 生产运行手册
4. 端到端演示脚本
5. 备份与监控

### 允许修改的范围
- 影响生产使用的 bug 修复（不限范围）
- `docs/runbook-production.md`（全新）
- `scripts/demo-script.sh`（全新）
- `scripts/backup.sh`（全新）
- 压测脚本（全新）

### 禁止修改
- 新功能
- 大幅度重构
- prisma schema 结构变更

### 具体任务

#### 17.1 全链路压测

场景设计：
```
并发用户：50 个 Web 调度员
在线司机：100 个（持续上报位置）
活跃订单：500 个
WebSocket 连接：100 个
运行时间：1 小时

观察指标：
- API 响应时间 P50/P95/P99
- WebSocket 消息延迟
- 数据库连接数
- Redis 内存使用
- CPU / 内存使用率
```

压测工具：artillery / k6
压测后记录指标，标记不达标的项并修复。

#### 17.2 生产运行手册
```markdown
# 生产运行手册

## 部署
- 环境准备清单
- Docker 部署步骤
- 首次部署验证

## 日常运维
- 服务启动/停止/重启
- 日志查看（Pino stdout）
- 数据库备份（pg_dump 定时任务）
- Redis 持久化检查

## 监控告警
- 关键指标看板（Grafana）
- 告警规则（API 错误率 > 1%、DB 连接数 > 80%、Redis 内存 > 80%）
- 值班响应手册

## 故障处理
- 数据库故障切换（主库 → 只读副本）
- WebSocket 服务宕机恢复
- API 限流触发后处理

## 备份与恢复
- 每日全量备份脚本
- 恢复演练步骤
```

#### 17.3 端到端演示脚本
```
步骤 1：导入 50 个订单 → 验证全部入库 status=PENDING
步骤 2：打开地图看板 → 验证 50 个订单点位正确显示
步骤 3：点击订单 → 查看推荐司机 Top 3 → 含推荐理由和 ETA
步骤 4：点击派单 → 订单状态 ASSIGNED → 写操作日志
步骤 5：司机微信小程序收到推送 → 查看任务详情
步骤 6：司机认领工单 → 状态 ACCEPTED → 一键导航
步骤 7：Web 地图实时显示司机位置移动轨迹
步骤 8：司机到达 → 确认完成 → 状态 COMPLETED
步骤 9：查看操作日志 → 全链路 traceId 可追踪
```

#### 17.4 备份与监控脚本
- `scripts/backup.sh`：pg_dump 每日全量备份
- `scripts/health-check.sh`：服务健康检查
- `scripts/restore.sh`：数据恢复脚本

### 验收标准
- [ ] 50 并发 + 100 司机 + 500 订单，压测 1 小时无崩溃
- [ ] WebSocket 100 连接稳定运行，断连率 < 0.5%
- [ ] 端到端演示脚本无报错走通
- [ ] 数据库备份脚本可正常执行和恢复
- [ ] 生产运行手册完整可执行
- [ ] 所有已知 P0/P1 bug 已修复
- [ ] `pnpm build` 生产构建成功

### 参考
- 升级方案第 10 节：验收标准
- [artillery.io](https://www.artillery.io/) 压测工具
- [k6](https://k6.io/) 压测工具
```

---

## 附：一次性全量升级 Prompt（给技术负责人的版本）

如果你想把整个升级方案一次性交给 LLM 来理解和规划，使用以下精简版 prompt：

```markdown
## 任务背景

我正在将一个人车单调度系统从 Demo 演示原型升级为生产级应用。

当前技术栈：Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Prisma + PostgreSQL（Supabase） + 高德地图 API + Pino 日志 + Vitest 测试。

项目遵循严格的阶段隔离开发模式，全局铁律定义在项目根目录 `CLAUDE.md` 中。

## 升级目标

1. **数据库**：从 Supabase 迁移到阿里云 RDS PostgreSQL，字段结构有变更（新增司机实时位置、ETA、微信绑定等字段）
2. **实时通信**：WebSocket 实现司机位置实时同步（3-5秒延迟）
3. **微信小程序**：司机端 App（实时定位 → 派单通知 → 认领工单 → 一键导航）
4. **调度引擎**：加权评分模型 + 批量 ETA 计算 + 多策略切换
5. **Web 端**：支持并发使用场景，地图实时更新

## 参考开源项目

这些项目的架构可以作为参考，但不要修改我们的技术栈：
- [Fleetbase](https://github.com/fleetbase/fleetbase) — 模块化物流调度 + 实时追踪
- [万岳外卖](https://github.com/WanyueKJ/Takeaway-Distribution) — 加权评分调度模型
- [Realtime Dispatch System](https://github.com/robert-nguyenn/realtime_dispatch_system) — 高并发架构
- [Mobius](https://github.com/mobius-scheduler/mobius) — 调度算法公平性权衡

## 关键文件

请先阅读以下文件，理解项目全貌：
1. 项目根目录 `CLAUDE.md` — 全局铁律 + 阶段定义
2. `docs/superpowers/specs/2026-07-04-demo-to-production-upgrade-plan.md` — 详细升级方案
3. 当前 demo 代码在 `feature-admin-workflow/` 目录中

## 要求

请按以下新增阶段顺序，分阶段输出可执行的代码和配置。每个阶段必须：
- 遵守 CLAUDE.md 的阶段隔离原则
- 不修改上游依赖
- 不提前实现下游功能
- 使用项目技术栈（Next.js/TypeScript/Prisma/Tailwind/shadcnui）

新增阶段：
12. production-infra（阿里云基础设施）
13. data-model-v2（数据模型升级）
14. realtime-engine（WebSocket 实时通信）
15. wechat-miniapp（微信小程序司机端）
16. dispatch-engine-v2（调度引擎升级）
17. production-stabilization（生产收尾）

先从阶段 12 开始。
```

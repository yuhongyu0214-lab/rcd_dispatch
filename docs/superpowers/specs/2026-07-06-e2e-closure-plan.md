# 端到端闭环修复方案

> 日期：2026-07-06 | 状态：P0 已完成，P1-P2 待指派 | 目标：生产部署前完成功能闭环

## 背景

当前 `feature-admin-workflow` 已实现完整代码骨架，但三个核心链路无法闭环：
1. 订单导入后位置不显示在高德地图看板
2. H5 司机端位置上报未实现
3. ETA 推荐派单 + 双端同步未端到端验证

经全链路代码审查，根因已定位，修复方案如下。

---

## 一、全链路数据流（现状 + 目标）

```
浏览器插件/XLSX 入单
  → API (/api/ingest/*, /api/import/*)
  → 地理编码 (AMap Geocode)        ← 🔴 B2/B3 缺失
  → PostgreSQL (pickupLat/Lng)
  → GET /api/map
  → getMapBoardData()
  → Redis 司机位置 (优先) / DB 回退   ← 🟡 Y3 依赖 Redis
  → MapBoard 前端渲染
  → AMap JS API 加载               ← 🔴 B1 阻断（已修复）
  → 地图点位渲染
  → 调度员选单 + 推荐司机
  → POST /api/dispatch/recommend
  → ETA 计算 (AMap Driving)        ← 🟡 Y2 降级数据
  → 派单确认 → Assignment 创建
  → 司机端轮询感知新工单             ← 🟡 Y1 缺失
  → 司机 GPS 上报 (/api/driver/location)
  → Redis + DB 持久化
  → 地图看板 15s 轮询更新司机位置
```

---

## 二、缺陷清单

### 🔴 P0 — 阻断级（不改功能不可用）

#### B1: MapBoard 硬性要求 amapSecurityCode

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/admin/map/components/map-board.tsx` |
| **行号** | 266, 813, 1347 |
| **现象** | `.env.local` 缺少 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`，MapBoard 检测 `!amapKey \|\| !amapSecurityCode` → 不加载 AMap，只显示 CSS 降级视图（灰色网格 + 彩色圆点） |
| **修复** | 3 处条件 `amapKey && amapSecurityCode` → `amapKey`；`_AMapSecurityConfig` 加 if 守卫 |
| **状态** | ✅ **已完成** — commit `af49ea3` |

#### B2: 浏览器插件入单不调地理编码

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/api/ingest/browser-extension/route.ts` |
| **行号** | 152-164（prisma.order.create） |
| **现象** | 插件入单时 `pickupLat/Lng` 和 `returnLat/Lng` 未赋值，入库为 `null`。`getMapBoardData()` 回退链最终调用 `offsetCoordinate(DEFAULT_MAP_CENTER, index)` → 所有无坐标订单堆在上海人民广场 |
| **修复** | 引入 `geocodeAddress()`；`prisma.order.create` 前并发地理编码取车/还车地址；坐标写入数据库 |
| **状态** | ✅ **已完成** — commit `af49ea3` |

#### B3: 通用入单 API 不调地理编码

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/api/ingest/order/route.ts` |
| **行号** | 74-92（prisma.order.create） |
| **现象** | 同 B2，仅从请求体取值 `body.pickupLat ?? null`，外部系统不传坐标时永久缺失 |
| **修复** | 同 B2：引入 `geocodeAddress()`；坐标缺失时并发地理编码作为回退 |
| **状态** | ❌ **待实施** |

### 🟡 P1 — 闭环阻断（功能可用但体验断裂）

#### Y1: 司机端任务列表无自动刷新

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/driver/tasks/page.tsx` |
| **行号** | 90-191（整个 Page 组件为 Server Component） |
| **现象** | 服务端渲染一次取数据，派单后司机端不会自动出现新工单，必须手动刷新浏览器 |
| **修复方案** | 新增 Client Component `TaskListPoller`：挂载后每 15s `fetch("/api/driver/tasks")`；有新工单时 CSS transition 高亮；保留 SSR 首次渲染不变 |
| **预估改动量** | ~40 行（新文件 `src/app/driver/components/task-list-poller.tsx`） + page.tsx 约 5 行 |

**伪代码**：
```tsx
// src/app/driver/components/task-list-poller.tsx
"use client";
import { useEffect, useState, useRef } from "react";

export function TaskListPoller({ initialTasks, driverId, cookieHeader }: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [newTaskIds, setNewTaskIds] = useState<Set<string>>(new Set());
  const prevCount = useRef(initialTasks.length);

  useEffect(() => {
    const id = setInterval(async () => {
      const res = await fetch(`/api/driver/tasks?driverId=${driverId}`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      const nextTasks = json.data.tasks;
      // 检测新增工单
      if (nextTasks.length > prevCount.current) {
        const existingIds = new Set(tasks.map((t: Task) => t.taskId));
        const newIds = new Set(
          nextTasks.filter((t: Task) => !existingIds.has(t.taskId)).map((t: Task) => t.taskId)
        );
        setNewTaskIds(newIds);
        setTimeout(() => setNewTaskIds(new Set()), 5000); // 5s 后取消高亮
      }
      prevCount.current = nextTasks.length;
      setTasks(nextTasks);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.taskId}
          task={task}
          driverId={driverId}
          highlight={newTaskIds.has(task.taskId)}
        />
      ))}
    </div>
  );
}
```

#### Y2: ETA Panel 使用硬编码模拟数据

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/admin/map/components/map-board.tsx` |
| **行号** | 753-785（`getEtaPlans()` 函数） |
| **现象** | `getEtaPlans()` 返回固定文本 "内环高架优先 18m" / "地铁 10 号线 38m"，从未调用高德驾车路径规划 API |
| **修复方案** | 新增 `GET /api/map/eta?orderId=X&driverId=Y` 调用 `lib/amap.ts` `drivingRoute()`；MapBoard 的 `etaPlans` 改为 `useState` + `useEffect`；保留硬编码作为 loading/error 降级 |
| **预估改动量** | ~50 行（新 API route + MapBoard 内 ~20 行改动） |
| **依赖** | `AMAP_SERVER_KEY` 已配置 |

**新增 API Route 伪代码**：
```typescript
// src/app/api/map/eta/route.ts
import { drivingRoute } from "@/lib/amap";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  const driverId = request.nextUrl.searchParams.get("driverId");
  // 查订单目的地坐标 + 司机起点坐标
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  // ... 坐标校验 ...
  const route = await drivingRoute(
    { lat: driver.lastLat!, lng: driver.lastLng! },
    { lat: order.pickupLat!, lng: order.pickupLng! }
  );
  const etaMinutes = Math.ceil(route.duration / 60);
  return ok({ etaMinutes, distanceMeters: route.distance, polyline: route.polyline });
}
```

#### Y3: 司机端位置上报 HTTPS 依赖

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/driver/components/driver-gps-tracker.tsx` |
| **行号** | 114-172 |
| **现象** | `navigator.geolocation.watchPosition()` 在非 HTTPS 环境（生产部署）被浏览器阻止 |
| **修复方案** | 非代码问题 — 部署文档/runbook 注明生产环境必须启用 HTTPS；开发环境 localhost 不受限 |
| **状态** | 部署 checklist 事项，无需代码改动 |

#### Y4: 默认地图中心硬编码上海

| 字段 | 内容 |
|------|------|
| **文件** | `src/lib/map/points.ts` |
| **行号** | 29-32 |
| **现象** | `DEFAULT_MAP_CENTER = { lat: 31.2304, lng: 121.4737 }` 对非上海门店不友好 |
| **修复方案** | 从第一个门店的车辆 GPS 坐标动态计算；无坐标点位标注 "位置待采集" 标签 |
| **预估改动量** | ~10 行 |

### 🟢 P2 — 代码质量（不影响功能）

#### G1: AMapMap 类型声明不完整

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/admin/map/components/map-board.tsx` |
| **行号** | 52-56 |
| **问题** | `AMapMap` 接口缺少 `setCenter()`、`getCenter()` 方法 |
| **修复** | 补充 `setCenter: (center: [number, number]) => void; getCenter: () => [number, number];` |

#### G2: 服务端组件反模式调自身 API

| 字段 | 内容 |
|------|------|
| **文件** | `src/app/driver/tasks/page.tsx` |
| **行号** | 114 |
| **问题** | Server Component 用 `fetch("http://localhost:3000/api/driver/tasks")` 调自己，应直接调 prisma |
| **修复** | 直接 `import { prisma }` 查数据库，去 `/api/driver/tasks` 的重复逻辑 |

#### G3: TypeScript 类型断言应改为类型守卫

| 字段 | 内容 |
|------|------|
| **文件** | `src/lib/map/points.ts` |
| **行号** | 155-157 |
| **问题** | `as Array<typeof orders[number] & { store: ... }>` 硬断言，空数组回退场景有风险 |
| **修复** | 用类型守卫函数替代 `as` 断言 |

---

## 三、实施清单（下游 Agent 按此顺序执行）

### Step 1 — P0 收尾（15 min）

- [ ] **B3**: `src/app/api/ingest/order/route.ts` — 引入 `geocodeAddress`，坐标缺失时回退地理编码（参考 B2 已完成的 `browser-extension/route.ts`）
- [ ] 运行 `pnpm build && pnpm test` 确认通过

### Step 2 — P1 闭环（1-2 hr）

- [ ] **Y1**: 新增 `src/app/driver/components/task-list-poller.tsx` — 客户端轮询 15s + 新工单高亮动画
- [ ] **Y1**: 修改 `src/app/driver/tasks/page.tsx` — 集成 `TaskListPoller`
- [ ] **Y2**: 新增 `src/app/api/map/eta/route.ts` — `GET /api/map/eta?orderId=X&driverId=Y`
- [ ] **Y2**: 修改 `src/app/admin/map/components/map-board.tsx` — `etaPlans` 改为异步请求 + 降级
- [ ] **Y4**: 修改 `src/lib/map/points.ts` — `DEFAULT_MAP_CENTER` 动态计算
- [ ] 运行 `pnpm build && pnpm test` 确认通过

### Step 3 — P2 清理（30 min）

- [ ] **G1-G3**: 按缺陷清单逐项修复
- [ ] 运行 `pnpm lint` 确认无新增告警

### Step 4 — 端到端验证

- [ ] 启动 `pnpm dev`
- [ ] 管理员登录 → 地图看板确认高德地图正常加载（非降级视图）
- [ ] Excel 导入订单 → 确认订单在地图上显示正确位置
- [ ] 浏览器插件入单 → 确认订单带坐标入库
- [ ] 选中订单 → 推荐派单 → 确认 ETA 面板显示真实驾车时间
- [ ] 派单 → 切换到司机端 → 确认自动出现新工单（无需手动刷新）
- [ ] 司机接单 → 确认地图看板司机位置更新（15s 内）
- [ ] 司机 GPS 上报 → 确认 `driver.lastLat/Lng` 写入 DB
- [ ] 完单 → 确认订单状态流转 COMPLETED

---

## 四、关键文件索引

| 文件 | 用途 | 改动 |
|------|------|------|
| `src/app/admin/map/components/map-board.tsx` | 地图看板核心组件 (1864 行) | B1✅ Y2❌ |
| `src/app/api/map/route.ts` | 地图数据 API | - |
| `src/lib/map/points.ts` | 地图点位构建逻辑 | Y4❌ G3❌ |
| `src/app/api/ingest/browser-extension/route.ts` | 浏览器插件入单 | B2✅ |
| `src/app/api/ingest/order/route.ts` | 通用 JSON 入单 | B3❌ |
| `src/lib/import/services/geocode.ts` | 地理编码服务（供入单 API 复用） | - |
| `src/app/driver/tasks/page.tsx` | 司机端任务列表 | Y1❌ G2❌ |
| `src/app/driver/layout.tsx` | 司机端布局（含 GPS Tracker） | - |
| `src/app/driver/components/driver-gps-tracker.tsx` | 浏览器 GPS 上报 | Y3 部署说明 |
| `src/app/api/driver/location/route.ts` | 位置上报 API | - |
| `src/lib/amap.ts` | 高德 API 封装（geocode + driving + ETA） | - |
| `src/lib/dispatch/engine.ts` | 派单引擎 | - |
| `src/lib/dispatch/eta.ts` | ETA 计算（Redis 缓存 + AMap） | - |
| `src/lib/redis.ts` | Redis 客户端 | - |
| `.env.local` | 环境变量 | 需补充 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` |

---

## 五、不在此次范围内的已知限制

1. **高德 API 日配额** — 免费版 5000 次/天，大批量导入可能触及；V2 考虑 geocode_cache 预填充
2. **Redis 依赖** — 司机位置优先 Redis，DB 仅作回退；Redis 不可用不影响功能但位置更新延迟增大
3. **司机端非原生 App** — 浏览器 `geolocation` 精度和稳定性不如原生 SDK；V2 考虑微信小程序 `wx.getLocation()`
4. **ETA 实时性** — 当前按需计算 + 60s Redis 缓存；不实时追踪司机移动后的 ETA 变化

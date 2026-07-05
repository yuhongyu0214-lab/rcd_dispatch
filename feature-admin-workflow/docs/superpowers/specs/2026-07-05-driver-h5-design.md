# Driver H5 端设计文档

## 元信息

- 日期：2026-07-05
- 阶段：driver-workflow（第 10 阶段，H5 改造）
- 原方案：微信小程序
- 新方案：H5 移动端网页

## 架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 技术栈 | Next.js App Router（复用现有项目） | 统一部署，共享 session/Tailwind/shadcn，不改技术栈 |
| 鉴权 | 统一登录 + 角色路由 | 复用 User 表 session，按 driverId 分流 |
| 路由 | `/driver/tasks` + `/driver/tasks/[id]` | 简洁两级路由，H5 原生体验 |
| GPS 策略 | watchPosition + 后台兜底 + 回前台追补 | 三通道保障，前台 ≤ 15s，后台 ≤ 120s |
| 导航 | 高德 URI Scheme（外链跳转） | 不内置地图，跳转高德 App |

## 页面结构

```
/driver              → 重定向 /driver/tasks
/driver/tasks        → 工单列表（tab：全部/待处理/进行中/已完成）
/driver/tasks/[id]   → 工单详情（接单/导航/完单 + 操作记录）
```

## 业务场景

```
管理员派单 → 司机在 /driver/tasks 看到 ASSIGNED 订单
  → 点击"接单" → POST /api/driver/tasks/[id]/accept
  → 订单 ACCEPTED，司机 S4
  → 点击"导航前往取车" → 跳转高德 uri.amap.com
  → 到达目的地 → 点击"确认完单" → POST /api/driver/tasks/[id]/complete
  → 订单 COMPLETED，司机 S1
```

## 取还车场景

| 订单类型 | 取车地址 | 还车地址 | 标签颜色 |
|---------|---------|---------|:--:|
| STORE_PICKUP 门店取车 | 门店 | 客户地址 | 蓝色 |
| DOOR_DELIVERY 送车上门 | 门店 | 客户地址 | 蓝色 |
| STORE_RETURN 门店还车 | 客户地址 | 门店 | 绿色 |
| DOOR_PICKUP 上门取车 | 客户地址 | 门店 | 绿色 |

## GPS 上报设计

- 主通道：`navigator.geolocation.watchPosition()` 持续监听
- 兜底：后台 `setTimeout` 120s 递归链，`getCurrentPosition` 主动拉取
- 追补：`visibilitychange` 回到前台时立即上报一次
- 状态指示器：绿（正常）→ 黄（连续 2 次失败）→ 红（连续 5 次失败）
- 失败提示：红点可点击查看详情，连续 5 次失败提示"请检查浏览器定位权限或网络连接"

## 卡片信息字段

每张工单卡片展示：
1. 取还方式标签（蓝/绿色）
2. 车牌号 + 车型
3. 取车地址 + 还车地址
4. 取车时间
5. 订单与司机距离（高德 API 驾车距离）
6. 操作按钮（待接单状态显示"接单"）

## 文件清单

| 文件 | 用途 |
|------|------|
| `src/app/driver/layout.tsx` | Driver 布局 + session 保护 + GPS 状态栏 |
| `src/app/driver/page.tsx` | 重定向 /driver → /driver/tasks |
| `src/app/driver/tasks/page.tsx` | 工单列表（SSR） |
| `src/app/driver/tasks/[id]/page.tsx` | 工单详情（SSR） |
| `src/app/driver/components/driver-gps-tracker.tsx` | GPS 三通道上报 + 状态指示 |
| `src/app/driver/components/task-card.tsx` | 工单卡片（服务端组件） |
| `src/app/driver/components/accept-button.tsx` | 列表页快捷接单按钮 |
| `src/app/driver/components/task-actions.tsx` | 详情页操作按钮组（接单/导航/完单） |
| `src/app/driver/components/copy-button.tsx` | 复制订单号按钮 |

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/middleware.ts` | matcher 增加 `/driver/:path*` |
| `src/app/admin/login/page.tsx` | 角色分流：driverId → /driver/tasks |
| `src/app/admin/login/components/login-form.tsx` | 登录后 driverId → /driver/tasks |
| `src/lib/auth/current-user.ts` | 新增 `requireDriverPage()` |

## 验收标准

- [x] `pnpm build` 编译成功（26/26 页面，含 3 个新 driver 路由）
- [x] `pnpm test` 27/27 通过
- [ ] `pnpm dev` 手动验证：管理员登录 → 跳转 /admin/import
- [ ] `pnpm dev` 手动验证：司机登录 → 跳转 /driver/tasks
- [ ] `pnpm dev` 手动验证：列表页 tab 切换、卡片信息完整
- [ ] `pnpm dev` 手动验证：详情页接单 → 导航 → 完单完整链路
- [ ] `pnpm dev` 手动验证：GPS 状态灯绿/黄/红切换
- [ ] `pnpm dev` 手动验证：复制订单号功能

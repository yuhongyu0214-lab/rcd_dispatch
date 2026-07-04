# demo_v12 设计参数提取

来源：`C:/Users/yhy/AppData/Local/Temp/人车单前端demo_v12.html`  
提取时间：`2026-06-27T07:34:59.819Z`  
模式：本地 HTML 静态提取。Browser Use 拦截了 `file://` 打开，因此未采集 computed style。

## 核心设计变量

### 色彩
- 页面背景：`oklch(0.945 0.006 235)`
- 左侧面板：`oklch(0.905 0.012 235)`
- 卡片表面：`oklch(0.985 0.003 235)`
- 地图底色：`oklch(0.875 0.018 230)`
- 深色 rail：`oklch(0.235 0.032 240)`
- 主强调/操作色：`oklch(0.635 0.115 35)`
- 成功：`oklch(0.590 0.115 160)`
- 预警：`oklch(0.690 0.125 76)`
- 风险：`oklch(0.610 0.160 27)`

### 字体
- 系统字体：`-apple-system, "SF Pro Display", "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif`
- 等宽字体：`"SF Mono", "Space Mono", Consolas, monospace`
- 正文字号：`15px`
- 数字：`tabular-nums`

### 圆角与阴影
- 圆角：`{"--radius-sm":"8px","--radius-md":"12px","--radius-lg":"16px"}`
- 卡片阴影：`0 6px 8px rgba(31, 35, 39, 0.08)`
- 浮层阴影：`0 18px 46px rgba(31, 35, 39, 0.18)`

## 关键布局尺寸

| 参数 | 值 |
|---|---:|
| rail 宽度 | 72px |
| 工作面板宽度 | 420px |
| 列表内容宽度 | 408px |
| 列表滚动条预留 | 12px |
| 设计画布 | 1488px × 1000px |
| panel-head | 396px |
| KPI 高度 | 60px |
| tab 高度 | 36px |
| 筛选控件高度 | 38px |
| 右侧头部 | 84px |
| 地图底部 dock | 236px |
| 详情卡 | 208px |
| 推荐卡 | 208px |

## UI/UX 约束

- **navigation**：rail icon 48x48 圆形按钮，active 使用 nav-active；主 step 跳转由 rail 完成。
- **objectTabs**：地图看板中的订单/司机/预警/车辆是对象筛选，不触发 step 跳转；在 KPI 卡片栏和地图标记中联动。
- **filters**：搜索与 select 选择即生效，无提交按钮；时间/状态需保留“全部”选项。
- **buttons**：主操作使用 action-button，次操作 ghost-button，风险操作 danger-button；按钮高度 32px，触摸目标 44px。
- **cards**：选中卡片使用 accent 边框和浅暖底色；未选中保留 surface-glass；状态用 badge 表达。
- **mapMarkers**：订单水滴、司机方向盘、车辆小车、门店小屋、预警三角；选中项放大，其余增强透明度。
- **recommendations**：推荐派单 Top N 固定在地图底部右栏，保留优先级、ETA、负载惩罚和 outcome，不展示中文推荐理由。

## 交互规则

- **autoFilter**：input/change 直接 render，无需提交。
- **refreshPoints**：刷新点位只更新点位状态与提示，不重置视图。
- **selectItem**：选中对象同步列表、详情、地图标记和底部 dock。
- **driverWorkflow**：司机管理用每人一行横向流程轴，状态点向右推进，右侧显示预计完成时间。
- **vehicleWorkflow**：车辆管理每车一行，支持车牌、车型、门店、GPS 状态模糊搜索，显示当前所属门店、当前订单、本月完单、本月营收、当前位置。

## API 占位

- `/api/orders/ingest`
- `/api/orders`
- `/api/orders/:id/geocode-output`
- `/api/map`
- `/api/dispatch/recommend`
- `/api/dispatch/confirm`
- `/api/drivers`
- `/api/drivers/:id/work-orders`
- `/api/vehicles/ingest`
- `/api/vehicles`
- `/api/logs`
- `/api/map/route`
- `/api/adapters/gps/mock`
- `/api/orders/:id`

## 迁移守则

- 不要直接套蓝白 SaaS 主题；保留灰蓝背景、深色 rail、暖棕 accent、青绿语义色的组合。
- 布局尺寸优先 token 化，禁止随页面内容改变 rail、panel、KPI、dock 高宽。
- 前端迁移到 Next/Tailwind 时，先把这些变量落到 CSS variables，再映射到组件 class。
- 本文件仅为设计参数提取结果，不代表正式 worktree 代码修改。

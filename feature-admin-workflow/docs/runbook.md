# 人车单 V1 演示 Runbook

## 1. 演示目标

本 runbook 用于 V1 演示前检查、演示链路执行和异常回滚。V1 演示链路为：

登录系统 -> 订单导入/订单池 -> 地图看板 -> 推荐派单 -> 手动派单/改派/撤回 -> 日志查询 -> 司机接单/完单 API 验收。

## 2. 环境变量检查

演示前确认 `.env.local` 至少包含以下变量：

| 变量 | 用途 | 检查方式 |
|---|---|---|
| `DATABASE_URL` | 应用运行时数据库连接，当前指向 Supabase 云数据库 | 不打印明文，只确认存在且可连接 |
| `SHADOW_DATABASE_URL` | Prisma migration shadow database | 仅迁移时使用 |
| `AUTH_SESSION_SECRET` | 登录会话签名 | 必须存在 |
| `NEXTAUTH_SECRET` | 兼容现有 auth 配置 | 必须存在 |
| `AMAP_SERVER_KEY` | 服务端高德路径规划 / ETA | 调度推荐前检查 |
| `NEXT_PUBLIC_AMAP_JS_KEY` | 前端高德地图渲染 | 接入真实高德 JS 地图前检查 |
| `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 前端高德 JS API 安全密钥 | 接入真实高德 JS 地图前检查 |
| `AUTH_COOKIE_SECURE` | 本地演示可为 `false` | 本地为 `false`，生产为 `true` |

本地检查命令：

```powershell
pnpm exec prisma validate
pnpm build
```

禁止在截图、日志或聊天中暴露 `.env.local` 的真实连接串和 key。

## 3. 数据库连接检查

当前数据库策略：使用 Supabase 云数据库，不使用本地 PostgreSQL 作为最终数据存储。

### 演示数据重置

演示前如需恢复稳定数据，先执行 dry-run：

```powershell
pnpm demo:reset
```

确认输出只包含以下固定演示数据后，再执行写库：

```powershell
pnpm demo:reset:apply
```

重置范围仅限：

- 订单：`DEMO-20260629-001`、`ORD-20260508-001`、`ORD-20260508-002`、`ORD-20260508-003`
- 司机：`张伟`、`李娜`、`王强`
- 车辆：`沪A12345`、`浙A67890`
- 门店：`上海虹桥店`、`杭州西湖店`

禁止在演示前执行全库清空。重置脚本只恢复演示链路所需的订单、司机、车辆、门店、派单记录和操作日志。

演示前检查：

```powershell
pnpm exec prisma validate
```

建议只读检查项：

| 表 | 检查目标 |
|---|---|
| `User` | 至少存在一个 `admin` 账号 |
| `Order` | 至少存在可演示订单，建议包含 `PENDING` / `ASSIGNED` |
| `Driver` | 至少存在可参与调度司机，状态为 `S1` / `S2` / `S3` |
| `Vehicle` | 至少存在车辆和车牌号 |
| `Assignment` | 派单、改派、司机接单后可回查 |
| `OperationLog` | 导入、派单、改派、撤回、接单、完单动作有记录 |

已知限制：

- Supabase 事务偶发出现 `Unable to start a transaction in the given time` 时，先重启本地 Next 服务释放连接池，再重试当前动作。

## 4. 高德 API 检查

V1 分两类高德能力：

| 能力 | Key | 用途 |
|---|---|---|
| 服务端路径规划 | `AMAP_SERVER_KEY` | 调度引擎计算 ETA |
| 前端 JS 地图 | `NEXT_PUBLIC_AMAP_JS_KEY` | 地图看板渲染真实在线地图 |
| 前端 JS API 安全密钥 | `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 高德 JS API 2.0 安全配置 |

演示前如果只使用当前 mock 地图，可不阻断演示；如果要验收真实 ETA 或真实地图渲染，需确认对应 key 已配置且额度可用。

## 5. 本地启动与健康检查

开发预览：

```powershell
pnpm dev
```

指定端口预览：

```powershell
pnpm exec next dev -p 3024
```

生产构建检查：

```powershell
pnpm build
```

浏览器入口：

- `http://127.0.0.1:3024/admin/login`
- `http://127.0.0.1:3024/admin/map`
- `http://127.0.0.1:3024/admin/orders?mode=orders`
- `http://127.0.0.1:3024/admin/orders?mode=logs`

默认调度员账号：

- 账号：`admin@dispatch.dev`
- 密码：`admin123`

## 6. 演示脚本

### Step 1 登录系统

1. 打开 `/admin/login`
2. 使用默认调度员账号登录
3. 登录后进入后台页面

验收：登录成功，无 500；失败时响应带 `traceId`。

### Step 2 查看订单池

1. 打开 `/admin/orders?mode=orders`
2. 检查订单列表、筛选、分页、日志入口
3. 选择一条待处理订单

验收：订单卡片与详情区域可联动，已完成订单不进入主待处理池。

### Step 3 地图看板

1. 打开 `/admin/map`
2. 检查订单、司机、车辆、门店点位
3. 切换 KPI 按钮和筛选条件

验收：地图看板布局稳定，浏览器缩放下整体等比例缩放，不出现模块漂移。

### Step 4 推荐派单

1. 在订单详情中触发推荐派单
2. 查看 Top N 候选司机
3. 检查 ETA、优先级、负载惩罚、结果字段

验收：候选列表返回可解释排序；无司机时返回 `PENDING / NO_DRIVER`；ETA 超限时返回 `MANUAL / ETA_EXCEEDED`。

### Step 5 手动派单 / 改派 / 撤回

1. 对 `PENDING` 订单执行派单
2. 对 `ASSIGNED` 订单执行改派
3. 对 `ASSIGNED` 订单执行撤回

验收：状态流转合法，`assignments` 和 `operation_logs` 可回查。

### Step 6 日志查询

1. 点击订单卡片的“查看日志”
2. 在日志搜索框输入订单号、司机姓名、车牌号或 traceId
3. 确认左侧日志卡片和右侧日志表同步过滤
4. 点击左侧任意日志卡片
5. 确认右侧切换为该订单 / 对象的时间轴明细
6. 点击“查看全部”回到全局日志

验收：日志包含动作、订单、司机、车牌、operator、traceId、时间、结果；模糊搜索和卡片时间轴均能联动。

### Step 7 司机端 API 契约

使用现有 Supabase 数据选择一条 `ASSIGNED` 且当前 assignment 为 `ACTIVE` 的订单：

```powershell
POST /api/driver/tasks/{orderId}/accept
POST /api/driver/tasks/{orderId}/complete
```

验收：

- 接单后：`Order.status = ACCEPTED`，`Assignment.status = ACCEPTED`，司机状态为 `S4`
- 完单后：`Order.status = COMPLETED`，`Assignment.status = COMPLETED`，司机状态为 `S1`
- `OperationLog` 写入 `ACCEPT` 和 `COMPLETE`

## 7. 回归清单

每次演示前至少执行：

```powershell
pnpm exec prisma validate
pnpm build
pnpm lint
```

如果测试环境依赖已恢复，再执行：

```powershell
pnpm test
```

当前已知测试环境风险：

- `vitest` 曾因跨 worktree 的 `feature-map-board` 下 `vite/esbuild` 链接缺失启动失败。若复现，先修复依赖链接，再判断测试本身是否失败。

## 8. Railway 回滚步骤

Railway 部署异常时按以下顺序处理：

1. 打开 Railway 项目控制台。
2. 进入当前服务的 Deployments。
3. 找到最近一个演示通过的成功部署。
4. 点击 Redeploy 或 Rollback 到该部署。
5. 确认环境变量仍完整存在，尤其是 `DATABASE_URL`、`AUTH_SESSION_SECRET`、`AMAP_SERVER_KEY`。
6. 部署完成后打开 `/admin/login` 验证登录。
7. 打开 `/api/health` 或等价健康检查接口确认数据库可连接。
8. 打开 `/admin/map` 与 `/admin/orders?mode=logs` 做页面冒烟。

回滚后禁止立即执行迁移。若怀疑数据库结构问题，先只读检查 schema 和最近 operation log，再决定是否单独处理迁移。

## 9. 已知风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| Supabase 事务连接超时 | 派单、接单、完单请求可能偶发失败 | 重启本地/服务端进程释放连接池，重试当前动作 |
| 高德 JS Key 未配置 | 真实在线地图无法渲染 | mock 地图不阻断，真实地图验收前补 key |
| 演示数据被多次验收改变 | 待处理订单减少或状态不匹配 | 先执行 `pnpm demo:reset` 检查，再执行 `pnpm demo:reset:apply` 恢复固定演示数据 |

## 10. 演示封板标准

- 登录、地图、订单池、日志页面均可打开
- `pnpm build` 通过
- 演示数据可通过 `pnpm demo:reset:apply` 恢复
- 至少一条派单/改派/撤回链路可演示
- 至少一条推荐派单链路可返回 Top N
- 至少一条司机接单/完单 API 链路可走通
- 日志查询支持订单号、司机、车牌、traceId 模糊搜索，并可点击卡片查看时间轴
- 所有关键接口响应带 `X-Trace-Id`
- 发现阻断问题时优先回滚，不在演示前新增功能

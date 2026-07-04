# 调度系统演示脚本（Runbook）

> **前提**：数据库已执行 `prisma migrate dev` + `prisma db seed`，`pnpm dev` 已启动。

---

## 第 1 步：登录后台

| 操作 | 详情 |
|------|------|
| 地址 | `http://localhost:3000/admin/login` |
| 账号 | `admin@dispatch.dev` |
| 密码 | `admin123` |
| 预期 | 登录成功，自动跳转到订单导入页 `/admin/import` |

---

## 第 2 步：导入订单

| 操作 | 详情 |
|------|------|
| 地址 | `http://localhost:3000/admin/import` |
| 操作 | 点击上传区域，选择 `.xlsx` 文件上传（符合导入模板格式） |
| 预期 | 合法订单入库，状态 `PENDING`；非法行逐行提示错误 |
| 关键 API | `POST /api/import/orders` |
| 日志检查点 | 终端输出 `import_started` → `import_finished`（含 traceId） |

---

## 第 3 步：查看订单列表

| 操作 | 详情 |
|------|------|
| 地址 | `http://localhost:3000/admin/orders` |
| 操作 | 按状态筛选（PENDING / ASSIGNED / COMPLETED 等），按关键词搜索（车牌号、地址） |
| 预期 | 列表正确展示订单号、类型、状态、门店、当前司机 |
| 关键 API | `GET /api/orders` |
| 验证点 | 响应 `X-Trace-Id` 头，Body 含 `traceId` |

---

## 第 4 步：地图看板

| 操作 | 详情 |
|------|------|
| 地址 | `http://localhost:3000/admin/map` |
| 操作 | 页面加载地图，查看订单点位（按状态着色）和司机点位 |
| 预期 | 上海虹桥店周边可见 2 个司机、至少 2 个 PENDING 订单；点击标记弹出详情卡片 |
| 关键 API | `GET /api/map` |
| 验证点 | 订单和司机坐标正确落在高德地图上 |

---

## 第 5 步：推荐派单 → 确认派单

| 操作 | 详情 |
|------|------|
| 地址 | 地图上选中一个 PENDING 订单，点击「推荐」按钮 |
| 操作 | 查看返回的候选司机列表（按状态、ETA、负载排序） |
| 预期 | 返回 Top 3 候选司机，含推荐理由（如"门店空闲，预计到达 18 分钟"）；ETA ≥ 120 标记 MANUAL |
| 关键 API | `POST /api/dispatch/recommend` |

| 操作 | 详情 |
|------|------|
| 操作 | 选择一个候选司机，点击「确认派单」 |
| 预期 | 订单状态 `PENDING → ASSIGNED`，司机状态变 `S3`，生成操作日志 |
| 关键 API | `POST /api/dispatch/confirm` |
| 日志检查点 | `recommend_finished` → `confirm_finished` |

---

## 第 6 步：撤回 / 改派

| 操作 | 详情 |
|------|------|
| 操作 | 订单列表中找到已派单订单，点击「撤回」 |
| 预期 | 订单状态 `ASSIGNED → PENDING`，司机恢复 `S1`，原派单记录置 `WITHDRAWN` |
| 关键 API | `POST /api/assignments/withdraw` |
| 日志检查点 | `withdraw_started` → `withdraw_finished` |

| 操作 | 详情 |
|------|------|
| 操作 | 对 ASSIGNED 订单点击「改派」，选择新司机 |
| 预期 | 原派单标记 RECYCLED，新派单创建，订单仍为 ASSIGNED |
| 关键 API | `POST /api/assignments/reassign` |
| 日志检查点 | `reassign_started` → `reassign_finished` |

---

## 全链路验证清单

| 检查项 | 验证方式 |
|--------|---------|
| traceId 贯穿 | 任意 API 响应体含 `traceId`，响应头含 `X-Trace-Id` |
| Pino 日志 | 终端输出 JSON 格式（开发环境自动彩色格式化） |
| 操作日志入库 | `npx prisma studio` → OperationLog 表可查到 派单/撤回/改派 记录 |
| 状态机合法 | 不会出现非法状态流转（如 COMPLETED → ASSIGNED） |

---

## 司机端 API（curl 验证）

```bash
# 获取任务列表
curl http://localhost:3000/api/driver/tasks -H "x-driver-id: <司机ID>"

# 接单
curl -X POST http://localhost:3000/api/driver/tasks/<派单ID>/accept -H "x-driver-id: <司机ID>"

# 完成任务
curl -X POST http://localhost:3000/api/driver/tasks/<派单ID>/complete -H "x-driver-id: <司机ID>"

# 位置上报
curl -X POST http://localhost:3000/api/driver/location \
  -H "Content-Type: application/json" \
  -H "x-driver-id: <司机ID>" \
  -d '{"lat": 31.23, "lng": 121.47}'
```

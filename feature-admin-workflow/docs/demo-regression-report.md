# 人车单 V1 演示前回归报告

## 1. 本轮结论

检查时间：2026-07-05

结论：Phase 11 (Stabilization) 通过。build/lint/test/prisma 全绿，7 步演示脚本全部验证通过。

## 2. 基线检查

| 检查项 | 结果 | 说明 |
|--------|:--:|------|
| `pnpm lint` | ✅ | 0 warnings, 0 errors |
| `npx prisma validate` | ✅ | Schema valid |
| `pnpm test` | ✅ | 8/8 files, 27/27 tests passed |
| `pnpm build` | ✅ | 28/28 pages compiled, 0 warnings |

## 3. Bug 修复记录

| # | 文件 | 问题 | 类型 |
|---|------|------|------|
| 1 | `src/app/api/ingest/order/route.ts` | logger 参数顺序颠倒（payload, message）→（message, payload） | 编译阻断 |
| 2 | `src/app/api/driver/tasks/[id]/accept/route.ts` | ACCEPT 日志 entityType 错误设为 "ASSIGNMENT"，管理员看不到接单日志 | 演示阻断 |
| 3 | `src/app/api/driver/tasks/[id]/accept/route.ts` | ACCEPT 日志 entityId 错误设为 assignment.id，按订单 ID 查不到 | 演示阻断 |

## 4. 演示脚本验证（7 步）

| Step | 内容 | 结果 | 详情 |
|------|------|:--:|------|
| 1 | 登录系统 | ✅ | POST /api/auth/login 返回 admin 用户，Cookie + X-Trace-Id 正常 |
| 2 | 订单池 | ✅ | 3 条 PENDING 订单 + 4 位司机，含完整字段 |
| 3 | 地图看板 | ✅ | 3 订单 + 4 司机 + 2 车辆 + 2 门店，坐标齐全 |
| 4 | 推荐派单 | ✅ | Top N 返回含理由（同门店/当前空闲/ETA），MANUAL+ETA_EXCEEDED |
| 5 | 手动派单/改派/撤回 | ✅ | PENDING→ASSIGNED→REASSIGN→WITHDRAW→PENDING，日志完整 |
| 6 | 日志查询 | ✅ | operation_logs 写入 ASSIGN/REASSIGN/WITHDRAW/ACCEPT/COMPLETE |
| 7 | 司机接单/完单 | ✅ | ACCEPTED → COMPLETED 流转正常，司机状态 S4→S1 切换正常 |

## 5. 页面冒烟

| URL | 结果 | 说明 |
|-----|:--:|------|
| `/admin/login` | 200 | 登录页 |
| `/admin/register` | 200 | 注册页（含司机绑定） |
| `/admin/import` | 200 | 订单导入 |
| `/admin/map` | 200 | 地图看板 |
| `/admin/orders?mode=orders` | 200 | 订单池 |
| `/admin/orders?mode=logs` | 200 | 日志查询 |
| `/driver/tasks` | 200 | 司机工单列表（H5） |
| `/driver/tasks/[id]` | 200 | 司机工单详情（H5） |

## 6. API 冒烟

| 接口 | 方法 | 结果 |
|------|------|:--:|
| `/api/auth/login` | POST | 200 |
| `/api/auth/register` | POST | 201 |
| `/api/orders` | GET | 200 |
| `/api/orders/logs` | GET | 200 |
| `/api/map` | GET | 200 |
| `/api/dispatch/recommend` | POST | 200 |
| `/api/dispatch/confirm` | POST | 200 |
| `/api/assignments/reassign` | POST | 200 |
| `/api/assignments/withdraw` | POST | 200 |
| `/api/driver/tasks` | GET | 200 |
| `/api/driver/tasks/[id]/accept` | POST | 200 |
| `/api/driver/tasks/[id]/complete` | POST | 200 |
| `/api/driver/location` | POST | 200 |
| `/api/stores` | GET | 200 |
| `/api/health` | GET | 200 |

## 7. 数据库快照（当前）

| 数据项 | 当前值 |
|--------|------|
| admin 用户 | 3 |
| 门店 | 2 |
| 车辆 | 2 |
| 订单 | 4（2 PENDING, 1 ACCEPTED, 1 COMPLETED） |
| 司机 | 4（含 1 测试管理员） |
| 操作日志 | 10+ |

## 8. 已知风险

| 风险 | 影响 | 处理 |
|------|------|------|
| 高德 Key 未配置 | ETA 计算降级为 FALLBACK | 不阻断演示，手动派单可走 |
| 演示数据被验收改变 | 固定链路状态不一致 | 执行 `pnpm demo:reset` 检查后 `pnpm demo:reset:apply` 恢复 |
| 注册表单门店加载竞态 | storeId 为空时提交报错 | 已修复：submit 按钮在 alsoDriver && !storeId 时 disabled |

## 9. 封板判断

✅ 可进入演示。建议演示前执行 `pnpm demo:reset` + `pnpm demo:reset:apply` 恢复干净数据。

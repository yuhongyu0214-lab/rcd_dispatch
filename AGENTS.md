# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

# 人车单调度系统 (RCD Dispatch)

汽车租赁可视化调度平台。V1 链路：订单导入 → 地图看板 → 推荐派单 → 调度闭环。当前正在向 PRD V2（实时滚动调度 + A/B/C 工单时间轴）兼容演进。

## 文档优先级（V2 生效后）

1. `docs/versions/v2.0/` 下的 V2 文档（PRD、数据架构、项目规则、API 契约、领域词汇、兼容矩阵）。
2. 本文件中不与 V2 冲突的工程铁律（下方标注）。
3. V1 文档与本文件的 V1 阶段描述，仅用于维护现有 V1 代码和历史追溯。

冲突裁决：数据安全与不可逆操作 > V2 规则 > 本文件工程铁律 > 已冻结契约 > V1 历史规则 > 原型与临时说明。

## V2 开发流程（当前主线）

V2 按串行闸门 + 受控并行推进，完整定义见 `docs/superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md`：

```
Gate -1 基线整理（已通过，develop @ 37ee8a3）
→ Gate 0 文档冻结 → Gate 1 Schema 与迁移 → Gate 2 DTO/API 契约落地
→ 第一轮并行（订单来源 / 实时位置 / 调度核心）→ Gate 3 调度事务集成
→ 第二轮并行（Web / 司机接口 / 观测）→ 迁移与端到端验证 → Gate 4 稳定化
```

- 每个 Gate 通过验收后才能创建下一阶段分支；不得提前建分支。
- V2 分支命名 `feature/v2-*`；合并路径仍为 `feature/* → develop → main`。
- 每个分支只能修改自己的独占文件范围；Schema、公共 DTO、共享样式、logger、调度事务各有唯一所有者线。

## 项目架构【工程铁律：继续有效】

- **多 worktree 并行开发**，每个 `feature-*` 目录是一个独立的 git worktree
- 正式应用代码位于 `feature-admin-workflow/`
- 包管理器锁定 `pnpm@10.11.0`，禁止用 npm/yarn
- API 统一响应格式：`lib/api-response.ts` 导出 `ok()` / `fail()`，含 `traceId`（V2 结构化 error 见 API 契约 V2）
- 高德 API 服务端 Key 用于路径规划（ETA 计算），JS Key 用于地图前端渲染
- 默认管理员账号：`admin@dispatch.dev` / `admin123`

## 技术栈（锁定）【工程铁律：继续有效】

- 全栈：Next.js 14 (App Router) + TypeScript
- UI：Tailwind CSS + shadcn/ui
- 数据库：PostgreSQL + Prisma ORM（迁移用 `prisma migrate dev`，查看用 `npx prisma studio`）
- 地图：高德 API（服务端 Key：`AMAP_SERVER_KEY`；前端 Key：`NEXT_PUBLIC_AMAP_JS_KEY`）
- 日志：Pino（stdout 输出），禁止 `console.log`
- 测试：Vitest（`pnpm test`，`@` 路径别名 = `./src`）
- 实时/短期数据用 Redis/Tair；业务事实只存 PostgreSQL

---

## 全局铁律（所有阶段必须遵守）【工程铁律：继续有效】

### 分支与合并

- 分支流：`feature/* → develop → main`，禁止跳过中间环节
- develop 始终可运行；main 始终可演示
- 每个 feature 退出时须通过本阶段验收标准

### 隔离原则

- 一个 worktree = 一个阶段，只能修改该阶段允许范围内的文件
- 禁止修改上游依赖（如 data-model 阶段不准动 prisma schema 结构）
- 禁止提前实现下游功能（如 order-import 阶段不准写地图组件）

### 提交格式

每条提交说明必须写四点：做了什么 / 没做什么 / 验收结果 / 退出条件

### 命名规范

- 文件命名：kebab-case（`order-lifecycle.md`）
- 组件命名：PascalCase（`OrderList.tsx`）
- 变量/函数：camelCase
- 枚举值：UPPER_SNAKE_CASE（`IN_PROGRESS`）

### 工具分工

| 工具 | 职责 |
|------|------|
| Trae + GPT 5.4 | 主力开发，代码实施 |
| Codex | 辅助开发，架构讨论与文档维护 |
| Warp/终端 | 分支切换、迁移执行、构建验证 |
| VS Code | diff 审查、只读观察 |

---

## V1 阶段执行顺序【V1 维护流程：已被 V2 Gate 流程取代，仅用于维护 V1 存量代码】

以下 1–11 阶段是 V1 的开发主线，已全部完成。V2 新功能不使用这些阶段名；修复 V1 存量 bug 时仍按原阶段的文件范围执行。

```
1.docs-prd → 2.repo-bootstrap → 3.data-model → 4.order-import → 5.map-board
→ 6.admin-workflow → 7.dispatch-rule-v1 → 8.logging-observe
→ 9.integration-adapter → 10.driver-workflow → 11.stabilization
```

### 1. docs-prd — 产品文档

- **目标**：产出 5 份冻结的业务文档
- **允许修改**：`docs/prd.md`、`domain-glossary.md`、`order-lifecycle.md`、`dispatch-rules-v1.md`、`import-template.md`
- **禁止**：写任何 `.ts`/`.tsx`/`.prisma` 代码
- **验收**：5 份文档全部冻结，术语无歧义，状态机完整

### 2. repo-bootstrap — 工程地基

- **目标**：可运行的 Next.js 空壳
- **允许**：`src/` 骨架、`lib/logger.ts`、`lib/api-response.ts`、`prisma/schema.prisma`（空模）、`.env.example`、ESLint/Prettier 配置
- **禁止**：业务页面、业务逻辑、真实数据模型
- **验收**：`pnpm dev` 可访问、`/api/auth/signin` 可渲染、`prisma studio` 可连接

### 3. data-model — 核心数据模型

- **目标**：6 张核心表 + 迁移 + 种子数据
- **允许**：`prisma/schema.prisma`、`prisma/migrations/`、`prisma/seed.ts`
- **禁止**：任何页面、API 路由、`lib/` 业务逻辑、`src/` 目录结构
- **验收**：`migrate dev` 无报错、`db seed` 写入 3 订单/2 司机/1 门店、`vehicles` 含 `gpsLat/gpsLng` 预留字段

### 4. order-import — 订单一键导入

- **目标**：Excel 上传 → 校验 → 地址转坐标 → 入库
- **依赖**：data-model 退出
- **允许**：`app/admin/import/`、`lib/import/`、`app/api/import/`
- **禁止**：地图组件、调度逻辑、prisma schema 结构修改
- **验收**：合法 Excel 全部入库 `status=PENDING`；非法数据逐行报错；地址转为经纬度

### 5. map-board — 地图看板

- **目标**：订单点位 + 司机点位 + 侧边栏联动
- **依赖**：order-import 退出
- **允许**：`app/admin/map/`、`lib/map/`、`app/api/map/`
- **禁止**：调度派单逻辑、prisma schema 修改
- **验收**：地图加载无报错、订单/司机点位按状态着色、点击标记同步显示详情卡片

### 6. admin-workflow — 调度员操作闭环

- **目标**：派单 / 改派 / 撤回 完整链路
- **依赖**：map-board 退出
- **允许**：`app/admin/orders/`、`app/api/orders/`、`app/api/assignments/`
- **禁止**：地图底层代码、调度推荐引擎
- **验收**：PENDING→ASSIGNED→ACCEPTED 手动走通；派单/改派/撤回均写操作日志

### 7. dispatch-rule-v1 — 推荐派单引擎

- **目标**：Top N 候选司机推荐，含推荐理由
- **依赖**：admin-workflow 退出
- **允许**：`lib/dispatch/`（全新）、`app/api/dispatch/recommend/`、`app/api/dispatch/confirm/`
- **禁止**：修改 admin-workflow 页面结构、prisma schema
- **验收**：`runDispatch()` 返回排序结果含推荐理由；ETA≥120 标记 MANUAL；confirm 使用事务防并发重复派单

### 8. logging-observe — 全链路日志

- **目标**：trace_id 贯穿 + 关键节点埋点
- **依赖**：order-import ~ dispatch-rule-v1 全部退出
- **允许**：`lib/logger.ts` 扩展、`lib/middleware/trace.ts` 新建、已有 API Route 埋桩
- **禁止**：修改业务逻辑、schema、页面结构
- **验收**：导入/派单/撤回全链路含 traceId；响应头带 `X-Trace-Id`

### 9. integration-adapter — 外部平台适配（Mock）

- **目标**：哈啰 / GPS 对接层，V1 用 mock 实现
- **允许**：`lib/adapters/`（全新）
- **禁止**：业务逻辑、schema 修改、任何页面
- **验收**：mock 接口可调用，返回结构符合 DTO 定义，JSDoc 注明真实实现替换位置

### 10. driver-workflow — 司机端 API（仅契约层）

- **目标**：接单 / 完成 / 位置上报的接口契约
- **策略**：V1 最小实现，用 Postman/curl 测试，不做 UI
- **允许**：`app/api/driver/`（全新）
- **禁止**：移动端 UI、前端组件
- **验收**：4 个接口 curl 可调通，状态流转符合 `order-lifecycle.md`

### 11. stabilization — 收尾与演示

- **目标**：bug 修复 + 演示脚本验证
- **允许**：影响演示的 bug 修复、`docs/runbook.md`
- **禁止**：新功能、大规模重构
- **验收**：6 步演示脚本无报错走通

---

## 命令速查

### 通用

| 命令 | 用途 |
|------|------|
| `pnpm dev` | 启动开发服务器（localhost:3000） |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm build` | 生产构建验证 |
| `pnpm lint` | ESLint 检查 |

### 数据库

| 命令 | 用途 |
|------|------|
| `npx prisma migrate dev` | 执行迁移（需 `.env.local`） |
| `npx prisma db seed` | 写入种子数据（需 `.env.local`） |
| `npx prisma studio` | 可视化查看表和数据（推荐） |
| `npx prisma validate` | 校验 schema 合法性 |

### 目录结构（不变部分）

```
src/
├── app/           # App Router 页面与 API 路由
├── lib/           # 业务逻辑与工具函数
├── components/    # 可复用 UI 组件
├── types/         # TypeScript 类型定义
prisma/
├── schema.prisma  # 数据模型（仅 data-model 阶段修改）
├── seed.ts        # 种子数据
├── migrations/    # 迁移文件（禁止手动修改）
docs/              # 业务文档（仅 docs-prd 阶段修改）
```

### 环境变量（.env.local 必须项）

`DATABASE_URL` / `SHADOW_DATABASE_URL` / `AUTH_SESSION_SECRET` / `AMAP_SERVER_KEY`

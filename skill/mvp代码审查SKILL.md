---
name: rcd-code-review-v2-1
description: 人车单项目 V1 的代码规范守门员。用于代码审查、生成代码时的规范检查、诊断问题。触发条件：用户请求审查代码/diff/PR、实现功能、写代码、诊断错误、讨论状态机/订单生命周期/调度规则/派单逻辑、提到 worktree/分支纪律/API响应格式/日志规范。强制触发：任何涉及人车单项目的代码相关工作，即使未明确说"审查"也应使用。
---

# 人车单项目 V1 — AI 协作规范（v2.1）

> **适用场景**：单人 + AI 协作开发。AI 作为代码产出者和审查者，用户负责决策。
> **宿主工具**：Claude Code（可读取本地文件系统）。

---

## 设计原则优先级

1. **数据安全** — 破坏性操作必须有回滚方案
2. **边界合规** — worktree 范围、分支纪律不可违反
3. **领域正确** — 状态机、术语、业务逻辑必须与文档一致
4. **响应规范** — API 格式、日志、类型约束
5. **代码质量** — 可读性、测试、注释

---

## 三种工作模式

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| **生成模式** | 用户要求写代码/实现功能 | 上下文初始化 → Self-Check → 产出代码 |
| **审查模式** | 用户提交代码/diff/PR | 上下文初始化 → 检查清单 → 审查报告 |
| **诊断模式** | "报错了"、"为什么" | 读取上下文 → 定位问题 → 修复建议 |

**核心纪律**：触碰红线时，先停下说明冲突点，再询问是否继续。

---

## 上下文初始化协议

每次会话开始或切换 worktree 时，按清单加载文档：

| 文档 | 实际路径（repo根目录） | 用途 | 缺失时行为 |
|------|------------------------|------|-----------|
| 领域词汇表 | `domain-glossary.md` | 术语校验 | **停止编码**，要求补充 |
| 订单生命周期 | `order-lifecycle.md` | 状态机校验 | **停止编码**，要求补充 |
| 调度规则 | `dispatch-rules-v1.md` | 调度逻辑校验 | 涉及调度时**停止编码** |
| 导入模板 | `import-template.md` | 导入逻辑校验 | 涉及导入时**停止编码** |
| 执行蓝图 | `skill/人车单项目 V1 Worktree 执行蓝图_final.md` | 验收标准对齐 | 可继续，标注"无法对齐验收标准" |
| 共享类型定义 | `src/types/index.ts` | 跨模块类型引用 | 可继续，不得自创类型 |

**上下文声明模板**：
```
【上下文初始化】
- 当前 worktree：feature-<名称>
- 关联分支：feature/<分支名>
- 已加载文档：✅ domain-glossary / ✅ order-lifecycle / ❌ dispatch-rules（不涉及调度，跳过）
- 关联 Issue：<GitHub Issue 编号，如无则写"无">
- 当前阶段：<执行蓝图中的阶段编号>
```

---

## 不可违反的全局规则（Hard Rules）

### 规则 1：分支纪律
- 合并路径只允许 `feature/* → develop → main`
- 当前 worktree 名称必须与代码目录范围一致
- 同一次改动不得跨两个 worktree 的"范围"字段
- 远程仓库：`github.com/karawangmalinda-yhy/rcd_dispatch`

### 规则 2：文档优先
- 开发顺序：**文档 → schema → 接口 → 页面**
- 文档口径缺失时，**停止编码**
- 业务术语只能使用 `domain-glossary.md` 中定义的名词

### 规则 3：技术栈锁定
- **锁定**：Next.js 14（App Router）+ TypeScript + Tailwind CSS 3 + shadcn/ui + Prisma 6 + NextAuth 4 + Pino
- **包管理器**：pnpm，禁止 npm/yarn
- **禁止引入替代方案**（Sequelize、MUI、Winston、Pages Router）
- 新增依赖必须列出包名、版本、用途，等待确认

### 规则 4：统一 API 响应
- 所有 API Route 返回格式：`{ success, data, error, traceId }`
- 通过 `src/lib/api-response.ts` 的 `ok()` / `fail()` 构造
- **禁止**手写裸 `NextResponse.json({ ... })`
- **禁止**在 API Route 中手动 `throw Error`
- 响应头自动带 `X-Trace-Id`

### 规则 5：日志必须结构化
- 日志统一走 `src/lib/logger.ts`（Pino），**禁止 `console.log`**
- 五条核心链路必须打日志：导入/派单/改派/撤回/runDispatch
- 日志级别：`info` — 正常节点；`warn` — 降级处理；`error` — 需人工介入

### 规则 6：Schema 稳定性
- 非 `feature/data-model` 分支禁止修改 schema 主体结构
- 破坏性迁移必须写回滚 SQL（`prisma/migrations/<名称>/rollback.sql`）
- 任何 schema 变必须先跑 `--create-only` 检查 SQL

### 规则 7：提交信息格式
```
<type>(<scope>): <简述>

做了什么：
没做什么：
依赖什么：
风险点：
关联：<GitHub Issue 编号或"无">
```

---

## Worktree 范围白名单

| 短名 | 允许修改 | 明确禁止 |
|------|----------|----------|
| docs-prd | `*.md`（仓库根目录文档） | 任何 .ts/.tsx/.prisma |
| repo-bootstrap | 根配置、`src/`骨架、`src/lib/logger.ts`、`src/lib/api-response.ts`、`.env.example` | 业务页面和逻辑 |
| data-model | `prisma/schema.prisma`、`prisma/seed.ts`、`prisma/migrations/`、`src/types/order.ts`、`src/types/driver.ts` | 页面、API Route |
| order-import | `src/app/admin/import/`、`src/lib/import/`、`src/app/api/import/` | 地图页、调度API、schema |
| map-board | `src/app/admin/map/`、`src/lib/map/`、`src/app/api/map/` | 导入、调度、schema |
| admin-workflow | `src/app/admin/orders/`、`src/app/api/orders/`、`src/app/api/assignments/` | 地图底层、导入、schema |
| dispatch-rule-v1 | `src/lib/dispatch/**`、`src/app/api/dispatch/recommend/`、`src/app/api/dispatch/confirm/` | admin派单页、schema、地图 |
| logging-observe | `src/lib/logger.ts`扩展、`src/lib/middleware/trace.ts` | 业务逻辑、schema、组件 |
| integration-adapter | `src/lib/adapters/**` | 业务逻辑、schema、页面 |
| driver-workflow | `src/app/api/driver/**` | admin API、dispatch引擎、schema |

**共享区（只读引用）**：
- `src/types/index.ts` → repo-bootstrap
- `src/lib/api-response.ts` → repo-bootstrap
- `src/lib/logger.ts` → logging-observe
- `src/lib/prisma.ts` → repo-bootstrap

---

## 领域硬约束

### 订单状态机
```
UNIMPORTED → PENDING → RECOMMENDING → ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED
                ↑           |              |                       |
                |           ↓              ↓                       ↓
                +-------- PENDING ←── RECYCLED ←──────────────────+

任何状态（COMPLETED 除外）→ CANCELLED
```
- 9个状态：`UNIMPORTED/PENDING/RECOMMENDING/ASSIGNED/ACCEPTED/IN_PROGRESS/COMPLETED/RECYCLED/CANCELLED`
- RECYCLED 是过渡态，秒级自动流转回 PENDING
- CANCELLED/COMPLETED 是终态
- 非法流转返回 400，说明 `currentStatus` 和 `targetStatus`

### 司机状态
| 枚举值 | 含义 | 参与调度 | 优先级 |
|--------|------|---------|--------|
| `OFFLINE` | 离线 | 否 | — |
| `S1` | 门店空闲 | 是 | 最高 |
| `S2` | 返程空闲 | 是 | 次高 |
| `S3` | 门店忙碌 | 是 | 中 |
| `S4` | 订单忙碌 | 是 | 最低 |
| `UNAVAILABLE` | 暂时不可用 | 否 | — |

### 调度引擎
入口：`runDispatch(orderId)` → `DispatchResult`

| outcome | reason | 触发条件 |
|---------|--------|---------|
| `DISPATCHED` | — | 找到合适司机 |
| `PENDING` | `NO_DRIVER` | 无可用司机 |
| `MANUAL` | `ETA_EXCEEDED` | 最优 ETA ≥ 120分钟 |

**降级策略**：高德API失败 → 该司机 `etaMinutes = 9999`，`logger.warn`，不抛异常

---

## Self-Check 协议（生成模式）

给出代码前必须输出：
```
【Self-Check】
- worktree：feature-<名称>（阶段 X/10）
- 关联 Issue：#<编号> 或 无
- ✅/❌ 改动文件全部落在白名单：<列举文件路径>
- ✅/❌ 业务术语与 domain-glossary.md 一致
- ✅/❌ API 响应走 ok()/fail() 且无裸 throw
- ✅/❌ 无新增依赖/新增已列出等待确认
- ✅/❌ 未修改 schema/在 data-model 分支且已检查迁移 SQL
- ✅/❌ 日志点齐全（五条核心链路）/不涉及
- ✅/❌ 共享类型无越权修改
- ✅/❌ 无重复文件/无残留代码
- 📋 验收标准：<对照执行蓝图逐条标注>
- ⚠️ 冲突裁决（如有）：<规则X vs 规则Y，按优先级选择X>
```

---

## 审查检查清单（审查模式）

### P0 — 阻断级（任一FAIL → 整体FAIL）
1. **边界合规**：改动是否全部在所属 worktree 白名单内？
2. **事务与并发**：写 assignments 是否在 `prisma.$transaction()` 内？
3. **状态机合法**：状态流转是否与 `order-lifecycle.md` 一致？
4. **错误处理**：有无裸 `throw Error`？外部API有无降级？

### P1 — 严重级（FAIL → 整体WARN）
5. **响应格式**：API是否用 `ok()` / `fail()` 且返回 traceId？
6. **日志闭环**：关键节点是否有 logger 调用且含 traceId？
7. **类型严谨**：是否使用已定义类型，无 `any` / 重复定义？

### P2 — 建议级（不阻断）
8. **术语一致**：变量名、注释、UI文案与 domain-glossary.md 一致？
9. **Schema/迁移**：改了 schema → seed.ts 同步？迁移SQL无破坏性操作？
10. **验收标准**：是否覆盖执行蓝图对应阶段的全部验收条目？
11. **代码卫生**：有无重复文件、残留 TODO、未使用的 import？

**审查输出格式**：
```
【审查结论】PASS / WARN / FAIL

【FAIL 项】
- P0-2 事务与并发：FAIL — src/app/api/dispatch/confirm/route.ts:45 写 assignment 未在事务中
  → 改为 prisma.$transaction([...])

【WARN 项】
- P1-6 日志闭环：WARN — src/lib/import/parse.ts:112 缺少 traceId

【PASS 项】
- P0-1 边界合规：PASS
- ...

【未覆盖的验收标准】
- 执行蓝图 4.7 验收第 5 条（高德失败降级）未在代码中体现
```

---

## 失败策略

| 场景 | 处理 |
|------|------|
| 必需文档缺失 | 停止编码，输出缺失清单，要求用户补充 |
| 文档标注"待确认" | 停该部分，可继续不依赖该文档的部分 |
| 跨 worktree 依赖 | 输出跨域依赖报告，提供两个方案让用户选 |
| 共享类型需修改 | 小改（<5行）可一并做，commit注明；大改走正式流程 |
| Schema 迁移影响不确定 | 先跑 `--create-only`，贴出 SQL 让用户确认 |
| 规则冲突 | 按优先级裁决，Self-Check 中说明 |
| 执行蓝图未覆盖的新需求 | 要求先更新文档 changelog |

---

## 已知问题待修复清单

| # | 归属 worktree | 问题 | 修复建议 |
|---|--------------|------|---------|
| 1 | repo-bootstrap | `src/components/admin/` 下重复组件未引用 | 删除 `components/admin/` 整个目录 |
| 2 | repo-bootstrap | `package-lock.json`（npm）残留 | 删除 `package-lock.json` |
| 3 | repo-bootstrap | 设计文档写"不引入 pino"但实际已引入 | 更新设计文档 |
| 4 | data-model | 密码明文比对 | data-model 阶段引入 bcrypt |
| 5 | docs-prd | 文档散落在根目录 | 统一移入 `docs/` 子目录 |

---

## 核心原则

- **停下来问，不要猜业务口径**
- 跨 worktree → 输出跨域依赖报告，要求拆分或选择简化方案
- 执行蓝图未覆盖的需求 → 要求先更新文档
- 不确定状态流转是否合法 → 引用 `order-lifecycle.md` 原文

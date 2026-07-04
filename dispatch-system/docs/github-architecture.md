# GitHub 仓库架构设计

> 人车单调度系统 - 基于 Git Worktree 的多分支并行开发架构

---

## 1. 分支模型总览

```
                          ┌─────────────────────────────┐
                          │           main              │
                          │      (生产主线，永远可演示)    │
                          │         🔒 受保护           │
                          └──────────────▲──────────────┘
                                         │
                                         │ 联调稳定后合并
                                         │
                          ┌──────────────┴──────────────┐
                          │          develop            │
                          │      (集成主干，日常联调)     │
                          │         🔒 受保护           │
                          └──────────────▲──────────────┘
                                         │
            ┌────────┬────────┬─────────┼─────────┬────────┬────────┐
            │        │        │         │         │        │        │
     ┌──────┴───┐ ┌──┴────┐ ┌─┴────┐ ┌──┴────┐ ┌──┴────┐ ┌──┴────┐ ┌──┴────┐
     │ docs-prd │ │ repo  │ │ data │ │ order│ │  map  │ │ admin │ │dispatch│
     │          │ │ boot  │ │model │ │import│ │ board │ │ work  │ │ rule  │
     └──────────┘ └───────┘ └──────┘ └──────┘ └───────┘ └───────┘ └───────┘
            ↑
        feature/* 分支
     (每个 worktree 独立目录)
```

---

## 2. 分支职责定义

### 2.1 长期分支

| 分支 | 职责 | 保护规则 | 生命周期 |
|------|------|----------|----------|
| `main` | 生产主线，永远可演示 | 禁止直接推送，PR 需审核 | 永久 |
| `develop` | 集成主干，日常联调 | 禁止直接推送，PR 需过 CI | 永久 |

### 2.2 短期分支

| 分支类型 | 命名规范 | 来源 | 合并目标 | 生命周期 |
|----------|----------|------|----------|----------|
| 功能分支 | `feature/*` | `develop` | `develop` | 开发完成后删除 |
| 修复分支 | `hotfix/*` | `main` | `main` + `develop` | 修复完成后删除 |
| 发布分支 | `release/*` | `main` | `main` (打标签) | 发布后保留 |

---

## 3. Feature 分支规划

### V1 必做分支（执行顺序）

```
执行顺序  分支名                        Worktree 目录              核心产出
──────────────────────────────────────────────────────────────────────────────
   1     feature/docs-prd             feature-docs-prd/         5份业务文档
   2     feature/repo-bootstrap       feature-repo-bootstrap/   工程初始化
   3     feature/data-model           feature-data-model/       数据模型
   4     feature/order-import         feature-order-import/     导入链路
   5     feature/map-board            feature-map-board/        地图看板
   6     feature/admin-workflow       feature-admin-workflow/   调度后台
   7     feature/dispatch-rule-v1     feature-dispatch-rule-v1/ 推荐引擎
   8     feature/logging-observe      feature-logging-observe/  日志观测
   9     feature/integration-adapter  feature-integration-adapter/ 外部适配
  10     feature/stabilization        feature-stabilization/    封板演示
```

### V1 暂缓分支

| 分支 | 说明 |
|------|------|
| `feature/driver-workflow` | 仅预留 API 契约，不做完整小程序 |

---

## 4. GitHub 仓库目录结构

```
dispatch-system/                         # 主仓库 (main 分支)
│
├── 📁 docs/                             # ═══ 业务文档 (feature/docs-prd) ═══
│   ├── prd.md                           # 产品需求文档
│   ├── domain-glossary.md               # 领域术语表
│   ├── order-lifecycle.md               # 订单生命周期
│   ├── dispatch-rules-v1.md             # 调度规则 V1
│   ├── import-template.md               # 导入模板说明
│   ├── runbook.md                       # 运维手册 (stabilization)
│   └── github-architecture.md           # 本文档
│
├── 📁 prisma/                           # ═══ 数据库 (feature/data-model) ═══
│   ├── schema.prisma                    # 核心表结构
│   │   # - orders        订单表
│   │   # - drivers       司机表
│   │   # - vehicles      车辆表
│   │   # - assignments   派单记录表
│   │   # - driver_locations 司机位置表
│   │   # - operation_logs 操作日志表
│   ├── seed.ts                          # 种子数据
│   └── migrations/                      # 迁移记录
│
├── 📁 src/
│   │
│   ├── 📁 app/                          # ═══ Next.js App Router ═══
│   │   │
│   │   ├── 📁 api/                      # API 路由
│   │   │   ├── 📁 auth/[...nextauth]/   # 认证 (repo-bootstrap)
│   │   │   ├── 📁 health/               # 健康检查 (repo-bootstrap)
│   │   │   ├── 📁 import/               # 导入接口 (order-import)
│   │   │   ├── 📁 orders/               # 订单管理 (admin-workflow)
│   │   │   ├── 📁 assignments/          # 派单管理 (admin-workflow)
│   │   │   ├── 📁 dispatch/             # 调度推荐 (dispatch-rule-v1)
│   │   │   │   ├── 📁 recommend/        # 推荐接口
│   │   │   │   └── 📁 confirm/          # 确认派单
│   │   │   ├── 📁 driver/               # 司机端接口 (driver-workflow)
│   │   │   │   ├── 📁 tasks/            # 任务列表
│   │   │   │   └── 📁 location/         # 位置上报
│   │   │   └── 📁 map/                  # 地图数据 (map-board)
│   │   │
│   │   ├── 📁 admin/                    # 调度员后台页面
│   │   │   ├── page.tsx                 # 首页仪表盘
│   │   │   ├── 📁 import/               # 订单导入页 (order-import)
│   │   │   ├── 📁 map/                  # 地图看板页 (map-board)
│   │   │   └── 📁 orders/               # 订单管理页 (admin-workflow)
│   │   │       ├── page.tsx             # 列表页
│   │   │       └── [id]/page.tsx        # 详情页
│   │   │
│   │   ├── 📁 auth/                     # 认证页面 (repo-bootstrap)
│   │   │   └── signin/page.tsx          # 登录页
│   │   │
│   │   ├── layout.tsx                   # 根布局
│   │   └── globals.css                  # 全局样式
│   │
│   ├── 📁 lib/                          # ═══ 核心库 ═══
│   │   ├── auth.ts                      # Auth.js 配置
│   │   ├── prisma.ts                    # Prisma 单例
│   │   ├── logger.ts                    # Pino 日志 (logging-observe)
│   │   ├── api-response.ts              # 统一响应格式
│   │   ├── utils.ts                     # 工具函数
│   │   │
│   │   ├── 📁 dispatch/                 # 调度引擎 (dispatch-rule-v1)
│   │   │   ├── types.ts                 # 类型定义
│   │   │   ├── filter.ts                # 候选筛选
│   │   │   ├── eta.ts                   # ETA 计算 (高德 API)
│   │   │   ├── sort.ts                  # 排序算法 + 负载惩罚
│   │   │   ├── constraints.ts           # 约束处理
│   │   │   └── engine.ts                # 统一入口 runDispatch()
│   │   │
│   │   ├── 📁 import/                   # 导入逻辑 (order-import)
│   │   │   ├── parser.ts                # Excel 解析
│   │   │   ├── validator.ts             # Zod 字段校验
│   │   │   └── geocoder.ts              # 地址转坐标 (高德)
│   │   │
│   │   ├── 📁 adapters/                 # 外部适配 (integration-adapter)
│   │   │   ├── types.ts                 # DTO 定义
│   │   │   ├── 📁 haluo/                # 哈啰适配器 (mock)
│   │   │   │   ├── index.ts             # fetchOrders()
│   │   │   │   └── mapper.ts            # 字段映射
│   │   │   └── 📁 gps/                  # GPS 厂商适配器 (mock)
│   │   │       ├── index.ts             # fetchVehicleLocation()
│   │   │       └── mapper.ts
│   │   │
│   │   └── 📁 middleware/               # 中间件 (logging-observe)
│   │       └── trace.ts                 # TraceID 贯穿
│   │
│   ├── 📁 components/
│   │   ├── 📁 ui/                       # shadcn/ui 组件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── ...
│   │   └── 📁 layout/                   # 布局组件
│   │       ├── sidebar.tsx              # 侧边栏
│   │       ├── header.tsx               # 顶部导航
│   │       └── admin-layout.tsx         # 后台布局
│   │
│   ├── 📁 types/
│   │   └── index.ts                     # 全局类型定义
│   │       # OrderStatus, DriverStatus, OrderType...
│   │
│   └── middleware.ts                    # 路由保护
│
├── 📁 .claude/                          # Claude Code 配置
│   ├── settings.json                    # 项目配置
│   ├── commands/                        # 自定义命令
│   └── memory/                          # 记忆文件
│
├── 📁 .github/                          # GitHub 配置
│   ├── workflows/                       # CI/CD
│   │   └── ci.yml
│   ├── ISSUE_TEMPLATE/                  # Issue 模板
│   └── PULL_REQUEST_TEMPLATE.md         # PR 模板
│
├── 📄 README.md                         # 项目说明
├── 📄 CLAUDE.md                         # Claude Code 指引
├── 📄 .env.example                      # 环境变量模板
├── 📄 next.config.mjs
├── 📄 tailwind.config.ts
├── 📄 tsconfig.json
└── 📄 package.json
```

---

## 5. Worktree 与分支映射

```
人车单生态/                              # 项目根目录
│
├── dispatch-system/                     # 主仓库 (main 分支检出)
│   ├── .git                             # Git 主仓库
│   ├── docs/
│   ├── prisma/
│   ├── src/
│   └── ...
│
├── feature-docs-prd/                    # feature/docs-prd worktree
│   └── docs/                            # 只修改文档
│
├── feature-repo-bootstrap/              # feature/repo-bootstrap worktree
│   ├── src/lib/                         # 基础库
│   ├── src/app/auth/                    # 认证页面
│   └── ...                              # 工程配置
│
├── feature-data-model/                  # feature/data-model worktree
│   └── prisma/                          # 只修改数据模型
│
├── feature-order-import/                # feature/order-import worktree
│   ├── src/app/admin/import/            # 导入页面
│   ├── src/app/api/import/              # 导入 API
│   └── src/lib/import/                  # 导入逻辑
│
├── feature-map-board/                   # feature/map-board worktree
│   ├── src/app/admin/map/               # 地图页面
│   └── src/lib/map/                     # 地图逻辑
│
├── feature-admin-workflow/              # feature/admin-workflow worktree
│   ├── src/app/admin/orders/            # 订单管理页面
│   └── src/app/api/orders/              # 订单 API
│
├── feature-dispatch-rule-v1/            # feature/dispatch-rule-v1 worktree
│   └── src/lib/dispatch/                # 调度引擎
│
├── feature-logging-observe/             # feature/logging-observe worktree
│   └── src/lib/logger.ts                # 日志增强
│
├── feature-integration-adapter/         # feature/integration-adapter worktree
│   └── src/lib/adapters/                # 外部适配器
│
├── feature-stabilization/               # feature/stabilization worktree (临时)
│
├── skill/                               # Claude Code Skills
├── 人车单-订单测试集/                    # 测试数据
└── 项目准备/                            # 规划文档
```

---

## 6. GitHub 分支保护规则

### 6.1 main 分支

```yaml
保护设置:
  - 禁止强制推送: ✅
  - 禁止删除: ✅
  - 允许合并:
      - 方式: Pull Request
      - 审核通过数: 1
      - CI 检查: 必须通过
  - 允许推送: 无 (仅 PR 合并)
```

### 6.2 develop 分支

```yaml
保护设置:
  - 禁止强制推送: ✅
  - 禁止删除: ✅
  - 允许合并:
      - 方式: Pull Request
      - 审核通过数: 0 (可自行合并)
      - CI 检查: 必须通过
  - 合并后删除源分支: ✅
```

---

## 7. 合并流程

### 7.1 Feature → Develop

```
┌──────────────────┐     push      ┌──────────────────┐
│  feature/xxx     │ ────────────▶ │  GitHub Remote   │
│  (本地 worktree) │               │  feature/xxx     │
└──────────────────┘               └────────┬─────────┘
                                           │
                                           │ gh pr create
                                           ▼
                                  ┌──────────────────┐
                                  │  Pull Request    │
                                  │  base: develop   │
                                  └────────┬─────────┘
                                           │
                                           │ CI 检查通过
                                           ▼
                                  ┌──────────────────┐
                                  │    develop       │
                                  │   (合并完成)      │
                                  └──────────────────┘
```

### 7.2 Develop → Main

```
┌──────────────────┐    PR/merge   ┌──────────────────┐
│    develop       │ ────────────▶ │      main        │
│  (联调稳定后)     │               │   (打 tag)        │
└──────────────────┘               └────────┬─────────┘
                                           │
                                           │ git tag v1.0.0
                                           ▼
                                  ┌──────────────────┐
                                  │ release/mvp-demo │
                                  └──────────────────┘
```

---

## 8. CI/CD 配置建议

### 8.1 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
          
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Lint
        run: pnpm lint
      
      - name: Build
        run: pnpm build
      
      - name: Type check
        run: pnpm type-check

  test:
    runs-on: ubuntu-latest
    needs: lint-and-build
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
```

### 8.2 Railway 部署

```yaml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "pnpm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
```

---

## 9. 开发工作流

### 9.1 创建新 Feature

```bash
# 1. 从 develop 创建新分支
git worktree add ../feature-xxx -b feature/xxx develop

# 2. 进入 worktree 开发
cd ../feature-xxx

# 3. 开发完成后提交
git add .
git commit -m "feat: 实现xxx功能

做了什么：xxx
没做什么：xxx
依赖什么：xxx
风险点：xxx"

# 4. 推送并创建 PR
git push -u origin feature/xxx
gh pr create --base develop --title "feat: xxx"
```

### 9.2 合并 Feature

```bash
# 1. PR 通过 CI 后合并 (网页操作或 CLI)
gh pr merge --squash

# 2. 清理 worktree
cd ../dispatch-system
git worktree remove ../feature-xxx

# 3. 拉取最新 develop
git pull origin develop
```

### 9.3 发布流程

```bash
# 1. 确认 develop 稳定
git checkout main
git pull origin main
git merge develop

# 2. 打标签
git tag -a v1.0.0 -m "V1 MVP Release"
git push origin main --tags

# 3. 创建发布分支 (可选)
git checkout -b release/mvp-demo
git push origin release/mvp-demo
```

---

## 10. 可视化时间线

```
时间 ──────────────────────────────────────────────────────────────────────▶

Week 1
main    ───────────────────────────────────────────────────────────────────▶
develop ──────●─────────────────────────────────────────────────────────────▶
              │
feature/      └─ docs-prd (合并)
docs-prd

Week 2
develop ───────────●────────────────────────────────────────────────────────▶
                    │
feature/            └─ repo-bootstrap (合并)
repo-bootstrap

Week 3
develop ─────────────────●────●─────────────────────────────────────────────▶
                          │    │
feature/                  │    └─ data-model (合并)
data-model                │
feature/                  └─ order-import (合并)
order-import

Week 4-5
develop ───────────────────────────●────●────●─────────────────────────────▶
                                    │    │    │
feature/                            │    │    └─ admin-workflow (合并)
map-board ──────────────────────────┘    │
feature/                                 └─ dispatch-rule-v1 (合并)
dispatch-rule-v1

Week 6
main    ────────────────────────────────────────────────●─── v1.0.0 ───────▶
                                                         │
develop ─────────────────────────────────────────────────●
                                                         │
feature/                                                 └─ stabilization
stabilization
```

---

## 11. 快速参考命令

```bash
# ═══ Worktree 操作 ═══
git worktree list                          # 查看所有 worktree
git worktree add ../feature-xxx feature/xxx # 创建 worktree
git worktree remove ../feature-xxx          # 删除 worktree
git worktree prune                          # 清理无效 worktree

# ═══ 分支操作 ═══
git branch -a                               # 查看所有分支
git checkout -b feature/xxx develop         # 创建新分支
git branch -d feature/xxx                   # 删除已合并分支

# ═══ PR 操作 ═══
gh pr create --base develop                 # 创建 PR
gh pr list                                  # 查看 PR 列表
gh pr merge 123 --squash                    # 合并 PR

# ═══ 标签操作 ═══
git tag -a v1.0.0 -m "Release"              # 创建标签
git push origin --tags                      # 推送标签
git tag -d v1.0.0                           # 删除本地标签
```

---

## 12. 状态图标说明

| 图标 | 状态 |
|------|------|
| ✅ | 已完成并合并 |
| 📝 | 进行中 |
| ⏳ | 待开发 |
| ⏸️ | 暂缓 |
| 🚫 | 已取消 |
| 🔒 | 受保护分支 |

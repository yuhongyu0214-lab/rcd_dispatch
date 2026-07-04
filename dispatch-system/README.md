# 人车单调度系统

> 汽车租赁可视化调度平台 MVP - 基于多 worktree 并行开发模式

---

## 项目概况

| 项目 | 说明 |
|------|------|
| 项目名称 | 人车单调度系统 |
| 技术栈 | Next.js 14 + TypeScript + Prisma + PostgreSQL |
| 部署平台 | Railway |
| 开发模式 | Git Worktree 多分支并行 |

---

## 分支架构

```
                    ┌─────────────────┐
                    │      main       │  ← 生产主线，永远可演示
                    │   (受保护)       │
                    └────────▲────────┘
                             │
                    ┌────────┴────────┐
                    │     develop     │  ← 集成主干，日常联调
                    │   (受保护)       │
                    └────────▲────────┘
                             │
     ┌───────────┬───────────┼───────────┬───────────┐
     │           │           │           │           │
┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
│docs-prd │ │  repo   │ │  data   │ │  order  │ │   map   │ ...
│         │ │bootstrap│ │  model  │ │ import  │ │  board  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
     ↑
 feature/* 分支 (每个 worktree 独立目录)
```

---

## 快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env.local

# 3. 初始化数据库
pnpm db:migrate && pnpm db:seed

# 4. 启动开发服务器
pnpm dev
```

默认账号：`admin@dispatch.dev` / `admin123`

---

## Feature 分支状态

| # | 分支 | 状态 | 核心产出 |
|---|------|------|----------|
| 1 | `feature/docs-prd` | 📝 | 业务文档冻结 |
| 2 | `feature/repo-bootstrap` | ✅ | 工程初始化 |
| 3 | `feature/data-model` | ⏳ | 数据模型 |
| 4 | `feature/order-import` | ⏳ | 导入链路 |
| 5 | `feature/map-board` | ⏳ | 地图看板 |
| 6 | `feature/admin-workflow` | ⏳ | 调度后台 |
| 7 | `feature/dispatch-rule-v1` | 📝 | 推荐引擎 |
| 8 | `feature/logging-observe` | ⏳ | 日志观测 |
| 9 | `feature/integration-adapter` | ⏳ | 外部适配 |
| 10 | `feature/stabilization` | ⏳ | 封板演示 |

---

## 目录结构

```
dispatch-system/
├── docs/                    # 业务文档
├── prisma/                  # 数据模型
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── api/             # API 路由
│   │   └── admin/           # 后台页面
│   ├── lib/                 # 核心库
│   │   ├── dispatch/        # 调度引擎
│   │   ├── import/          # 导入逻辑
│   │   └── adapters/        # 外部适配
│   └── components/          # UI 组件
└── .claude/                 # Claude Code 配置
```

---

## 开发规范

### 提交格式

```
做了什么：xxx
没做什么：xxx
依赖什么：xxx
风险点：xxx
```

### 合并路径

```
feature/* → develop → main → release/*
```

---

## 相关文档

- [GitHub 仓库架构设计](./docs/github-architecture.md)
- [Worktree 执行蓝图](./docs/worktree-blueprint.md)
- [调度规则 V1](./docs/dispatch-rules-v1.md)

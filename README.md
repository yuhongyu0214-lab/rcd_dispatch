# 人车单调度系统

汽车租赁可视化调度平台 MVP

---

## 快速启动

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
Copy-Item .env.example .env.local
```

如果你使用的是 macOS / Linux，也可以执行：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少填写以下三项：

```
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."       # openssl rand -base64 32
AMAP_SERVER_KEY="..."
```

变量说明：

- `DATABASE_URL`：本地 PostgreSQL 连接串
- `NEXTAUTH_SECRET`：NextAuth 会话签名密钥
- `AMAP_SERVER_KEY`：后续地图服务预留，当前分支先保留在 bootstrap 基线中

### 3. 初始化数据库

```bash
# 执行迁移
pnpm db:migrate

# 写入种子数据（调度员账号）
pnpm db:seed
```

### 4. 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

默认账号：

- 邮箱：`admin@dispatch.dev`
- 手机号：`13800000000`
- 密码：`admin123`

### 5. 基础校验

```bash
pnpm lint
```

完成后按以下顺序人工确认：

1. 打开 `http://localhost:3000`
2. 访问 `/api/health`，确认返回成功 JSON
3. 访问 `/auth/signin`
4. 使用邮箱或手机号加密码登录
5. 确认成功跳转到 `/admin`

---

## 验收检查清单（feature/repo-bootstrap）

- [ ] `pnpm dev` 无报错，localhost:3000 可访问
- [ ] `/auth/signin` 登录页正常显示
- [ ] 使用邮箱 `admin@dispatch.dev` 或手机号 `13800000000` 均可登录，跳转到 `/admin`
- [ ] `pnpm db:studio` 可连接数据库，User 表有种子数据
- [ ] `GET /api/health` 返回 `{ success: true, data: { status: "ok", db: "connected" }, error: null, traceId }`，并带 `X-Trace-Id` 响应头
- [ ] `.env.example` 包含 `DATABASE_URL`、`NEXTAUTH_SECRET`、`AMAP_SERVER_KEY`
- [ ] `pnpm lint` 通过

---

## 目录结构

```text
feature-repo-bootstrap/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-21-repo-bootstrap-design.md
├── prisma/
│   ├── migrations/
│   ├── schema.prisma                # Bootstrap 用户模型
│   └── seed.js                      # 默认管理员种子数据
├── src/
│   ├── app/
│   │   ├── admin/                   # 已登录后台入口
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/  # Auth.js 路由
│   │   │   └── health/              # 健康检查
│   │   ├── auth/signin/             # 登录页
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── page-shell.tsx       # 页面级容器
│   │   │   └── section-card.tsx     # 通用卡片容器
│   │   └── ui/
│   │       └── status-badge.tsx     # 最小展示组件
│   ├── lib/
│   │   ├── api-response.ts          # 统一响应格式
│   │   ├── auth.ts                  # Auth.js 配置
│   │   ├── logger.ts                # Bootstrap 日志入口
│   │   ├── prisma.ts                # Prisma 单例
│   │   └── utils.ts                 # 基础工具函数
│   ├── types/
│   │   └── index.ts                 # 共享接口类型
│   └── middleware.ts                # /admin 路由保护
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── README.md
├── next.config.mjs
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 分支规范

目标工作分支：`feature/repo-bootstrap`

合并目标：`develop`（退出条件满足后合并，`develop` 稳定后再合 `main`）

下一个分支：`feature/data-model`

参考：`docs/人车单项目_V1_Worktree_执行蓝图_final.md`

---

## 注意事项

- 当前密码为明文对比，`feature/data-model` 阶段接入 bcrypt
- 当前仅保留 bootstrap 所需 `User` 模型，业务表在 `feature/data-model` 阶段补齐
- 第四阶段补共享骨架，日志使用 pino，UI 不引入 `shadcn/ui` 等额外框架
- `NEXT_PUBLIC_AMAP_JS_KEY` 在 `feature/map-board` 阶段启用

---

## 当前工程约定

- 当前规范只依赖仓库已有的 `ESLint` 与 `Prettier` 配置，不新增 hooks、提交校验或格式化脚本
- 命令以 `package.json` 中现有脚本为准，文档不提前声明仓库里不存在的工具入口
- 目录边界以 `src/app`、`src/lib`、`src/components`、`src/types` 为准，后续功能优先按这些位置落档

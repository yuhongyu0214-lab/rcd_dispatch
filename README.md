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
cp .env.example .env.local
```

编辑 `.env.local`，至少填写以下三项：

```
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."       # openssl rand -base64 32
AMAP_SERVER_KEY="..."
```

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

默认账号：`admin@dispatch.dev` / `admin123`

---

## 验收检查清单（feature/repo-bootstrap）

- [ ] `pnpm dev` 无报错，localhost:3000 可访问
- [ ] `/auth/signin` 登录页正常显示
- [ ] 使用种子账号可成功登录，跳转到 `/admin`
- [ ] `npx prisma studio` 可连接数据库，User 表有种子数据
- [ ] `GET /api/health` 返回 `{ success: true, data: { status: "ok", db: "connected" } }`
- [ ] `.env.example` 包含 `DATABASE_URL`、`NEXTAUTH_SECRET`、`AMAP_SERVER_KEY`

---

## 目录结构

```
dispatch-system/
├── prisma/
│   ├── schema.prisma       # 数据模型（占位，data-model 阶段完整填充）
│   └── seed.ts             # 种子数据
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/  # Auth.js 路由
│   │   │   └── health/              # 健康检查
│   │   ├── auth/signin/             # 登录页
│   │   ├── admin/                   # 调度员后台（后续 feature 填充）
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── lib/
│   │   ├── auth.ts                  # Auth.js 配置
│   │   ├── prisma.ts                # Prisma 单例
│   │   ├── logger.ts                # Pino 日志封装
│   │   ├── api-response.ts          # 统一响应格式
│   │   └── utils.ts                 # 工具函数
│   ├── types/
│   │   └── index.ts                 # 全局类型（枚举对齐 domain-glossary.md）
│   ├── components/
│   │   ├── ui/                      # shadcn/ui 组件（按需添加）
│   │   └── layout/                  # 布局组件
│   └── middleware.ts                # 路由保护
├── docs/                            # 业务文档（不在此分支修改）
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── next.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

---

## 分支规范

当前分支：`feature/repo-bootstrap`

合并目标：`develop`（退出条件满足后合并，develop 稳定后合 main）

下一个分支：`feature/data-model`

参考：`docs/人车单项目_V1_Worktree_执行蓝图_final.md`

---

## 注意事项

- 当前密码为明文对比，`feature/data-model` 阶段接入 bcrypt
- `prisma/schema.prisma` 业务表为占位结构，`feature/data-model` 完整填充
- `NEXT_PUBLIC_AMAP_JS_KEY` 在 `feature/map-board` 阶段启用
- 生产部署到 Railway 时，日志设置 `LOG_PRETTY=false`，JSON 输出到 stdout

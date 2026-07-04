# 人车单调度系统

汽车租赁可视化调度平台 MVP

当前工作目录聚焦 `feature/data-model` 阶段，优先完成核心业务数据模型、迁移、回滚脚本与最小种子数据。

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
SHADOW_DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."       # openssl rand -base64 32
AMAP_SERVER_KEY="..."
```

注意：

- `.env.local` 必须真实存在于项目根目录，否则 `pnpm db:migrate`、`pnpm db:seed` 和 `/api/health` 都会因为缺少 `DATABASE_URL` 失败
- `DATABASE_URL` 必须替换成可连接的 PostgreSQL 连接串，模板占位值不能直接使用
- 如果当前数据库用户没有 `CREATEDB` 权限，需额外提供 `SHADOW_DATABASE_URL`，指向一个可用的 shadow 库，供 `prisma migrate dev` 使用

### 3. 初始化数据库

```bash
# 执行迁移
pnpm db:migrate

# 写入种子数据（管理员 + 最小业务主数据）
pnpm db:seed
```

当前种子内容包括：

- 默认管理员账号
- 2 个门店
- 3 个司机
- 2 台车辆

### 4. 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

默认账号：`admin@dispatch.dev` / `admin123`

说明：

- 当前 `seed.js` 已将默认密码改为 `bcrypt` 哈希存储
- 账号的输入方式仍保持 `admin@dispatch.dev` / `admin123`

---

## 验收检查清单（feature/data-model）

- [ ] `.env.local` 已创建，且 `DATABASE_URL` 为真实可用的 PostgreSQL 连接串
- [ ] `pnpm prisma validate` 通过
- [ ] `pnpm build` 通过
- [ ] `pnpm dev` 无报错，localhost:3000 可访问
- [ ] `pnpm db:migrate` 成功执行
- [ ] `pnpm db:seed` 成功执行
- [ ] `pnpm db:studio` 可连接数据库，能看到 `User`、`Store`、`Driver`、`Vehicle`、`Order`、`Assignment`、`OperationLog`
- [ ] `GET /api/health` 返回 `{ success: true, data: { status: "ok", db: "connected" } }`
- [ ] `prisma/migrations/20260502120000_data_model_core/rollback.sql` 已落盘
- [ ] `.env.example` 包含 `DATABASE_URL`、`NEXTAUTH_SECRET`、`AMAP_SERVER_KEY`
- `.env.example` 包含 `DATABASE_URL`、`SHADOW_DATABASE_URL`、`NEXTAUTH_SECRET`、`AMAP_SERVER_KEY`

---

## 当前阶段说明

- 当前仓库已经完成核心 Prisma 数据模型落地
- 当前仓库仍未补登录页面、认证路由与后台页面，这些旧 README 描述不再适用于此工作目录
- 首页和开发服务器可正常启动
- `/api/health` 是否成功取决于 `DATABASE_URL` 是否真实可用

## 目录结构

```
dispatch-system/
├── prisma/
│   ├── schema.prisma       # 核心业务数据模型
│   ├── seed.js             # 管理员与最小业务主数据种子
│   └── migrations/         # 含 data_model_core 迁移与 rollback.sql
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── health/              # 健康检查
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── lib/
│   │   ├── prisma.ts                # Prisma 单例
│   ├── types/
│   │   ├── driver.ts                # 司机 / 车辆 / 门店类型
│   │   ├── order.ts                 # 订单 / 派单 / 操作日志类型
│   │   └── index.ts                 # 聚合导出
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

当前工作目录：`feature-data-model`

合并目标：`develop`（退出条件满足后合并，develop 稳定后合 main）

当前目标：完成数据模型阶段落地与验证

参考：`docs/人车单项目_V1_Worktree_执行蓝图_final.md`

---

## 注意事项

- 当前 `seed.js` 已切到 `bcrypt`
- `prisma/schema.prisma` 已完成核心业务表建模
- 若要跑通数据库链路，必须先创建 `.env.local`
- `NEXT_PUBLIC_AMAP_JS_KEY` 在 `feature/map-board` 阶段启用
- 生产部署到 Railway 时，日志设置 `LOG_PRETTY=false`，JSON 输出到 stdout

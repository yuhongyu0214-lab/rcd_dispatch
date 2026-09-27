# 人车单调度系统（RCD Dispatch）

面向汽车租赁业务的调度平台，覆盖订单接入、司机实时位置、A/B/C 工单时间轴、真实 ETA、人工调度和司机执行闭环。

本文件是仓库导航，不替代产品、接口、数据或部署规则。

## 从哪里开始

| 需要了解的内容 | 入口 |
|---|---|
| 正式应用源码、测试与发布配置 | [feature-admin-workflow/](feature-admin-workflow/) |
| 项目协作与工程纪律 | [AGENTS.md](AGENTS.md) |
| Agent 开工前公共上下文 | [Layer 0](docs/context/agent-common-context.md) |
| 各领域权威与角色阅读入口 | [文档版本总入口](docs/versions/README.md) |
| 项目状态与验收历史 | [状态总览](docs/status/README.md) |
| Stage 6 预生产验收及用户接受的范围例外 | [最终验收记录](docs/status/2026-09-27-stage6-final-acceptance.md) |
| 构建、部署与回退规则 | [部署指南 V2](docs/versions/v2.0/deployment-guide-v2.md) |
| V1 来源材料与兼容边界 | [历史索引](docs/versions/v1/README.md) · [兼容矩阵](docs/versions/v2.0/v1-v2-compatibility-matrix.md) |

新任务须先读取 Layer 0，再读取对应角色入口，并明确代码基线、文档基线和文件白名单。状态文档按记录时点保留；当前分支位置须另外通过 Git 核验。

## 应用与本地验证

唯一正式应用目录为 `feature-admin-workflow/`。依赖版本由该目录的 `package.json` 和 `pnpm-lock.yaml` 锁定；包管理器使用 `pnpm@10.11.0`，不使用 npm 或 Yarn。

以下命令在独立、本地测试环境运行；不要复制预生产密钥或连接真实数据库、Redis/Tair、高德服务。真实外部集成测试只在另行授权后启用。

```powershell
cd feature-admin-workflow
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm test
pnpm lint
pnpm exec tsc --noEmit --incremental false
pnpm build
```

Prisma Client 生成仅准备本地客户端，不是数据库迁移。启动服务前，应按正式指南配置隔离环境；不要直接执行历史文档中的 seed、迁移或部署步骤。

## 仓库边界

- `feature-admin-workflow/` 保留现行源码、全部测试、迁移与回退 SQL、Docker 和部署配置，不因 V1 名称或旧日期删除兼容实现。
- `docs/versions/v2.0/` 按领域定义现行规则；`docs/status/` 保存验收、运行与回退证据。
- 其他保留的 V1 目录、子模块指针和旧说明只用于历史追溯，不是新任务的应用入口。
- 第一批整理只移除退出正式构建的旧地图/导入工程快照及根目录的临时预览产物。历史内容可从整理前的 `c523fccd7febb06ac15ea379e57e06110aa1ec69` 追溯；不重写 Git 历史。

代码候选 SHA、治理文档 SHA、主线分支 SHA 和服务器运行的镜像 digest 分别记录。仓库整理和 Git 推送不会自动更新预生产服务，也不代表正式生产发布。

合并路径保持 `feature/* → develop → main`。分支删除、历史资料进一步归档、镜像构建、数据库操作和部署均不包含在第一批目录整理中。

# Gate 3-R 状态：部署入口加固候选

> 状态：`PASS_ECS_DIGEST_AND_MIGRATION_VERIFIED_APP_PENDING`
> 日期：2026-08-02；实施复核：2026-08-05
> 当前本地候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`
> 回退候选：`169f2ad8b27f9f0be2d4630144315694656b6a67`
> 非授权范围：本状态不授权 Git 推送、ECS/Docker 操作、数据库迁移、部署或云资源变更

## 1. 变更范围

本地候选只修改以下四个部署入口文件：

- `feature-admin-workflow/deploy/README.md`
- `feature-admin-workflow/deploy/compose.preprod.yml`
- `feature-admin-workflow/deploy/nginx/rcd.conf.template`
- `feature-admin-workflow/scripts/deployment-artifacts.test.mjs`

未修改业务代码、Prisma Schema、migration、依赖或锁文件。

## 2. 加固结果

- Compose 使用显式 profile；裸执行 `docker compose up -d` 不启动业务服务。
- 启动顺序固定为 migration → app → readiness → worker → edge/Nginx。
- app 容器 readiness 使用受保护的 `X-Internal-Key`；现有路由代码支持该请求头。
- Nginx 不信任外部传入的 `X-Trace-Id`，无可信值时使用自身 request id。
- migration、app、worker 和 edge 必须逐步启用，禁止一次性启用全部 profile。

## 3. 验证证据

| 检查项 | 结果 |
|---|---|
| Git 父子关系 | 新候选直接继承旧候选 |
| 工作区 | HEAD/远程均为 `492c86e…`；候选 worktree 干净 |
| 测试 | 完整回归 462 通过、7 项按条件跳过；部署文档专项测试 4/4 通过 |
| Lint | 通过 |
| Diff 检查 | 通过 |
| migration tree | `c9b46aa4782b8b909e1bcc238e7514bf538270f1`，与旧候选一致 |
| Schema blob | `196a87c71c2bff94da6cce2ed39d2717f60ab355`，与旧候选一致 |

### 3.1 人工复核阻断项

候选实际配置文件名为 `deploy/compose.preprod.yml`，上一候选 `7378303…` 的 `deploy/README.md` 四条启动命令没有显式携带受控环境文件和 `-f deploy/compose.preprod.yml`。当前候选 `492c86e…` 已把 `config`、migration、app、worker 和 edge 五条命令全部修正为显式 `--env-file` + `-f`，并把部署测试收紧为五次完整前缀断言；专项测试 `scripts/deployment-artifacts.test.mjs` 已通过（4/4）。修正已提交、普通推送并形成 ACR 镜像；ECS 已按 digest 拉取，真实预生产 migration 已独立完成，app/worker/edge 仍未启动。

## 4. 当前追溯边界

- 本地分支 HEAD 与 Git 远程同名分支均为 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`。
- 当前 ACR 镜像对应 `492c86e…`，远端 digest 为 `sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d`；镜像内 revision 和平台 `linux/amd64` 已在 ECS 核验。
- 上一候选镜像对应 `7378303…@sha256:1292f8…af57`，继续保留在 ACR/ECS。
- 回退镜像对应 `169f2ad8b27f9f0be2d4630144315694656b6a67`，digest 为 `sha256:6e37995289a05a7462bd02b873498ae5cc87fda70ebe73e0d29b53d258cb2674`，已与当前镜像一并保留在 ECS。
- ECS 已保留一次性 migration 与权限验收证据容器；app、worker、Nginx 没有启动。RDS 9 个 migration 与最小权限验收已通过。

## 5. 下一闸门

1. `deploy/README.md` 与部署测试修正已经完成专项/完整复验、提交和普通推送；不得继续修改业务、Schema、migration 或依赖。
2. 当前 `linux/amd64` ACR 镜像已经按远程 SHA 构建、推送并记录 digest，未创建 `latest`；上一与回退镜像继续保留。
3. 当前 digest、部署目录、受控配置、依赖连通和一次性 migration 已完成；不得重复 migration。
4. 先关闭 migration owner 长期入口，再单独批准 app-only 启动与 readiness；worker 和 edge 继续冻结。

Gate 3 仍为 `NOT_PASS`，第二轮并行继续冻结。

大白话：修正版包装箱已经进入服务器，数据库施工也完成了；现在先收回施工钥匙，再只启动应用做健康检查，不能把后续角色一次性全开。

# Gate 3-R 状态：ACR 不可变镜像发布

> 状态：`CURRENT_PREVIOUS_AND_ROLLBACK_IMAGE_TRACE_PASS`
> 日期：2026-08-02；状态复核：2026-08-05（Asia/Shanghai）
> 当前镜像候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`
> 上一镜像候选：`7378303f513d92e781a7930cfff7e14269ec3126`
> 回退镜像候选：`169f2ad8b27f9f0be2d4630144315694656b6a67`
> 非授权范围：本状态不授权 ECS、RDS、Tair、SLS、网络、部署或 migration 变更

## 1. 发布结果

当前候选的 Git 远程与 ACR 事实已在发布流程中独立核验；本轮文档同步未重新连接阿里云控制台：

| 项目 | 当前候选 | 上一候选 | 回退候选 |
|---|---|---|---|
| Git SHA / tag | `492c86ea51b40da9426b8ad5b6aef861aa429ab5` | `7378303f513d92e781a7930cfff7e14269ec3126` | `169f2ad8b27f9f0be2d4630144315694656b6a67` |
| digest | `sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d` | `sha256:1292f8f552c5528c20f48737fe6d2b47bd0aa14813e89eaf4a8f4381f77aaf57` | `sha256:6e37995289a05a7462bd02b873498ae5cc87fda70ebe73e0d29b53d258cb2674` |
| 镜像 revision | 与对应 Git SHA 一致 | 与对应 Git SHA 一致 | 与对应 Git SHA 一致 |
| 运行平台 | `linux/amd64` | `linux/amd64` | `linux/amd64` |
| ACR 可读 | 已确认 | 已确认 | 已确认 |
| ECS 拉取 | 已确认 | 已确认 | 已确认 |

- 未创建 `latest`；`unknown/unknown` 是构建证明文件，不是额外运行镜像。
- ECS 未启动 app、worker 或 Nginx；当前镜像已用于一次性预生产 migration 与权限验收。三份镜像继续保留，剩余空间不沿用旧数值冒充实时事实。

## 2. 本地独立核验

- 本地 HEAD 与远程同名分支均为当前候选完整 SHA `492c86e…`。
- 当前候选从上一候选 `7378303…` 直系演进；Schema blob 与 migration tree 未变化，migration tree id 仍为 `c9b46aa4782b8b909e1bcc238e7514bf538270f1`。
- 当前候选提交记录的完整回归基线为 462 通过、7 项条件跳过，并通过 lint、类型、Prisma、生产构建与容器检查。
- 部署 README 与部署测试两项修正已经进入当前 Git SHA 和镜像；候选 worktree 干净，专项测试 4/4 与完整工程回归均通过。

## 3. 放行与停止条件

当前候选与回退候选的 Git SHA、镜像 revision、平台和 digest 追溯子闸门通过。ECS 必须按完整摘要引用，不得只依赖 tag：

```text
当前：<ACR地址>/<命名空间>/<仓库>@sha256:fb12371fefa3bdd6cba318b8fd25cb8031c0211f2e81a43c85e614174633d27d
上一：<ACR地址>/<命名空间>/<仓库>@sha256:1292f8f552c5528c20f48737fe6d2b47bd0aa14813e89eaf4a8f4381f77aaf57
回退：<ACR地址>/<命名空间>/<仓库>@sha256:6e37995289a05a7462bd02b873498ae5cc87fda70ebe73e0d29b53d258cb2674
```

进入 app 容器启动前仍需：

1. 保持当前完整 digest，禁止改用 tag 或 `latest`；
2. 关闭 migration owner 长期连接入口；
3. 单独取得 app-only 启动与 readiness 授权；
4. 保持 migration 为一次性独立闸门，不得重复执行。

## 4. 当前结论

当前、上一与回退镜像的 Git/ACR/ECS 追溯子闸门 `PASS`；当前镜像已完成真实预生产 migration 与权限验收，但应用运行和 Gate 3 总闸门尚未通过，第二轮并行继续冻结。

大白话：新包装箱、上一箱和备用箱都已在服务器验明身份；新箱子已经完成一次性数据库施工，应用本身仍没有开机。

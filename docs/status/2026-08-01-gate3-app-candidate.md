# Gate 3-R 状态：应用候选 SHA 收口

> 状态：`GIT_ACR_TRACE_PASS_AWAITING_ECS_PULL`
> 更新时间：2026-08-03（Asia/Shanghai）
> 当前步骤编号：`G3R-APP-05`
> 当前可追溯应用候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`

## 1. 候选范围

该候选唯一收口以下成果：

1. Gate 3 P0/P1 返修与 G3-3 调度编排、锁、事务提交和并发保护；
2. 独立事务 outbox migration 与 HTTP-only 周期 worker；
3. 受保护内部端点、司机鉴权与生产登录面安全；
4. Tair Key 前缀和 Redis 冷启动修复；
5. Next.js / React / Excel 依赖安全返修；
6. 空库演练定位并修复两处 rollback 外键拆除顺序，未改变正向 migration 或 Schema；
7. Docker/Compose/Nginx 三角色部署包、V2 liveness/readiness 和高德轻量探针；
8. 容器 OpenSSL/CA 运行时补齐；当前镜像已完成 ACR 不可变追溯，上一候选与回退镜像已在 ECS 保留；
9. Compose 显式 profile、分阶段启动、受保护 readiness 与 Nginx trace 入口加固。

## 2. 候选证据

| 对象      | 结果                                      |
| --------- | ----------------------------------------- |
| Git       | HEAD 与远程均为 `492c86e…`；候选 worktree 干净，普通快进推送已核验 |
| 应用版本  | Next.js 15.5.21；React / React DOM 19.2.8 |
| Excel     | SheetJS 官方 CDN 0.20.3                   |
| 依赖审计  | 0 个已知漏洞                              |
| 回归      | 462 项通过，7 项条件跳过                  |
| 质量检查  | lint、类型检查、Prisma、生产构建全部通过  |
| 数据模型  | Schema 与业务枚举未因框架适配改变         |
| migration | 精确 9 个；最终清单/checksum 已生成       |
| 空库演练  | 新 SHA 原始对象正向 9/9、Schema diff 0、rollback 8/8、护栏 5/5 |
| 部署包    | app、HTTP-only worker、一次性 migration 共用同一镜像，按命令和秘密边界分角色 |
| 容器运行  | `linux/amd64`；OpenSSL/CA、非 root、健康检查与 Prisma 运行时检查通过 |
| ACR/ECS   | 当前 `492c86e…@sha256:fb1237…d27d` 已在 ACR 核验；上一 `7378303…@sha256:1292f8…af57` 与回退 `169f2ad…@sha256:6e3799…2674` 已在 ECS 保留；未创建 `latest` |

## 3. 文档口径

- 当前 Gate 3 代码验收只认本页顶部的完整 SHA；中间提交、来源分支和主工作区未提交文件不是候选。
- `492c86e…` 的 Git 远程、ACR 镜像 revision、digest 和 `linux/amd64` 平台已对齐；`7378303…` 退为上一候选，`169f2ad8…` 继续作为回退候选。
- Compose 命令修正已经提交并进入当前可追溯候选；ECS 尚未按当前 digest 拉取，仍不得执行 migration、注入秘密或启动容器。
- HTTP 契约、领域枚举、数据模型和设计变量分别由 `docs/versions/v2.0/` 下的权威文档定义。
- 框架适配只改变服务端内部读取方式，没有改变外部 HTTP 行为。
- Railway 是历史 Demo 证据，不是当前生产架构或发布指令；生产目标以 Gate 3-R 阿里云基建裁决为准。

## 4. 串行闸门

- [x] 唯一应用候选 SHA；
- [x] 完整依赖安全返修；
- [x] 权威文档内容更新；
- [x] 文档一致性审查 PASS；
- [x] 从候选 Git 对象生成 9 个 migration 清单/checksum；
- [x] 一次性空 PostgreSQL 演练库完成整链迁移与回退保护验收；
- [x] 应用部署可用性返修和容器运行检查；
- [x] 当前候选 Git 远程、ACR 不可变镜像与 digest 核验；
- [x] 回退候选镜像保留并核验；
- [x] 部署命令显式选择 `compose.preprod.yml`，对应专项测试于 2026-08-03 独立复验 4/4；
- [x] 对两项修正执行完整回归、lint、类型检查、Prisma、生产构建与依赖审计；
- [x] 生成新 SHA、完成普通推送并重新建立 ACR digest 追溯；
- [ ] ECS 按当前 digest 拉取并核验 revision/platform；
- [ ] 阿里云 app/worker、RDS/Tair 与运维证据闭环；
- [ ] Gate 3 终审 PASS。

Gate 3 与第二轮并行继续冻结。Git/ACR 追溯通过不授权连接 RDS/Tair、注入秘密、执行 migration 或启动容器。

指纹清单见 [Gate 3 最终 migration 清单与 checksum](2026-08-01-gate3-migration-manifest.md)，镜像证据见 [ACR 不可变镜像发布](2026-08-02-gate3r-acr-image-publication.md)。

大白话：修正版包装箱已经完成体检并放进 ACR；ECS 里仍是上一箱和备用箱。等恢复服务器登录后先把当前箱子拉下来核对，数据库和应用仍不能开机。

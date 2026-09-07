# 人车单生产部署、迁移与回退指南 V2

> 文档版本：`RCD-DEPLOY-V2.0-R14-20260903`
>
> 状态：Gate 3 预生产最近已核验运行身份为 `958afca…`；Gate 4 本地 `4d370d6…` 安全返修与独立复审通过，远端 RC 尚待验收，G4-5 保持阻断；本次文档同步不授权构建、推送、部署或 migration
>
> 权威范围：构建、镜像、发布、迁移、启动、验证和回退顺序
>
> 非权威范围：平台选择理由、业务状态机、API 字段、日志保留期和事故响应组织

## 1. 白话结论

每次发布都必须能回答三个问题：发布的是哪次代码提交、用了哪个不可变镜像、失败后退回哪里。数据库迁移只运行一次，成功后才能启动新 app 和 worker。禁止把未提交工作区直接部署，也禁止 app 和 worker 各自抢着执行迁移。

本文定义发布流程，不代表任何阿里云资源已经创建，也不提供未经验证的生产命令。

## 2. 发布对象

| 对象 | 来源 | 生产身份 |
|---|---|---|
| 源代码 | 已审查并获准的 Git commit | 完整 commit SHA |
| 镜像 | 由该 commit 在受控流水线构建 | ACR 不可变标签，至少包含 commit SHA |
| app | 同一镜像的 Web/API 启动角色 | 常驻服务 |
| worker | 同一镜像的后台事件处理角色 | 常驻单副本 |
| migration | 同一镜像或同一提交产生的一次性迁移角色 | 成功/失败后退出 |
| 配置 | 目标环境的受控变量与秘密 | 不写入镜像和 Git |

生产追溯链必须满足：

```text
Git commit SHA
  = 构建来源
  → ACR 不可变镜像摘要
  → app / worker / migration 使用的镜像
  → 发布记录与回退目标
```

`latest` 可以作为人工浏览标签，但不得成为唯一生产标识。

## 3. 环境与权限前提

发布前必须确认：

- 目标环境已明确为开发、测试、预生产或生产，不能使用模糊的“默认环境”。
- 目标 RDS、Tair、域名、证书和日志空间已经通过只读盘点；未知项不得用猜测补齐。
- app、worker、migration 的账号和网络权限分离且最小化。
- 生产管理员默认密码、公开注册和演示账号展示已经关闭。
- 所有秘密只核对名称、来源、权限和轮换状态，不在发布记录中保存值。
- 数据库备份已完成并有可验证的恢复点。

### 3.1 ECS 与 Docker 权限边界

- Docker Engine 与 Compose 只从 Docker 官方 APT 仓库安装；预生产和生产禁止使用 convenience script。
- 安装完成后记录 Docker Engine、Compose plugin、containerd 和操作系统版本，作为部署证据。
- `root` 私钥只用于首次引导和受控恢复。正式运行前应建立具名运维账号；关闭 root 登录前必须先验证具名账号和恢复通道。
- Docker daemon 默认仅使用本机 Unix socket，禁止对公网开放未认证的 `2375/2376` 或其他管理端口。
- 加入 `docker` 组等同授予 root 级主机控制权，只允许经过明确授权的受信任运维人员；普通应用账号不得加入。
- ECS 拉取 ACR 使用只读拉取凭证；构建/推送凭证与运行凭证分离。任何凭证、私钥、数据库连接串或高德 Key 都不得写入 Git、镜像层、Compose 文件或终端历史。
- app、worker 和一次性 migration 使用各自最小权限秘密；应用端口不得直接暴露公网，只允许经 Nginx 入口访问。

## 4. 标准发布闸门

```text
1. 冻结发布候选 commit
2. 代码、测试、类型、lint、构建和安全检查
3. 构建同一不可变镜像并推送 ACR
4. 记录镜像摘要、commit SHA、上一稳定版本
5. 生产前备份和迁移预检
6. 停止会与迁移冲突的写入或进入获准维护/灰度窗口
7. 仅运行一次 migration
8. migration 验证成功
9. 启动或滚动更新 app
10. 验证匿名 liveness 与受保护 readiness
11. 启动单副本 worker
12. 验证 worker、outbox、日志和关键业务冒烟
13. 观察窗口通过后宣布发布完成
```

任一步失败均停止，不得跳过失败步骤继续“试试看”。

## 5. 构建与镜像

- 只从干净、已提交、已批准的分支或 commit 构建。
- 包管理器锁定为项目规定的 pnpm 版本，依赖安装必须遵循锁文件。
- 构建阶段不得把 `.env.local`、数据库连接串、Redis 密钥、JWT、证书私钥或云访问密钥复制进镜像层。
- 镜像标签至少包含完整或可唯一映射的 commit SHA；发布记录同时保存镜像 digest。
- app、worker 和 Nginx 必须注入完整 `RCD_RELEASE_REVISION`，其值与已批准 Git commit 完全一致；镜像 digest、OCI revision 和运行环境 revision 任一不一致都必须停止。
- app、worker、migration 使用同一个镜像，避免三个角色运行不同代码。
- 构建产物必须经过依赖、安全、测试、类型、lint 和生产构建检查；具体命令以项目工程纪律和获准流水线为准。

### 5.1 Gate 4 无 shell 运行镜像与制品验收

本节落实[APP-006](application-decision-log.md#app-006gate-4-运行镜像与传递依赖安全返修例外)，不改变单 ECS、同一镜像三角色及后续分阶段发布顺序。

- 已批准本地候选：`4d370d664c3710a4a03cb1b665cfdeddc7d32778`。runner 固定为 `gcr.io/distroless/nodejs22-debian13:nonroot@sha256:4e4fb0ce55fd73901600796ef079a9490369d2515d7da31633a91608c82ca13b`；构建阶段继续使用候选 Dockerfile 固定的 Node 22/Bookworm。该调整不授权更换宿主 OS 或 Nginx 镜像。
- runner 使用 UID/GID `65532:65532`；无 shell、运行包管理器、setuid/setgid 或 mount/umount。诊断通过宿主受控工具或显式 Node 探针完成，不向最终镜像补装调试工具。
- app 使用 `node server.js`；worker 使用 `node scripts/dispatch-event-worker.mjs`；migration 使用 exec-form `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma`。不得在运行容器内调用 `sh -c`、pnpm/npx 或依赖 `.bin` shell wrapper。健康检查同样使用 exec-form Node；Prisma `--version` 探针不等于已执行迁移。
- 构建来源必须是批准 commit 的 Git 原始归档，记录归档 SHA-256；不得直接复制 Windows 脏工作区。构建后的全部 19 份 migration/rollback 必须与该归档逐文件 raw SHA-256 相等且 CR=0；不能以换行归一化后的比较掩盖制品差异，也不能修改历史 SQL 来追平坏镜像。
- 代码来源 SHA、治理文档 SHA 分开登记。只改文档的后继提交不能冒充既有 OCI revision；后续任务必须明确锁定实际构建来源，不得隐式使用分支 HEAD。
- 本地占位高德参数制品仅用于隔离验证。真实配置重建前须另行批准源码推送、构建参数类别、新完整 SHA tag 与 ACR 推送；只注入获准的浏览器构建配置，不把高德服务端 Key、数据库或云凭据放入构建参数。本轮禁止 `latest` 和覆盖既有 tag。
- 远端验收必须重核 source/tag → index → amd64 manifest → config → OCI revision 与扫描对象，重验 19/19 SQL、非 root、bcrypt、Prisma、app/worker 探针及 Compose 三角色同 digest。容器安全扫描与秘密扫描分别记录，不能互相替代。
- 固定 R55 库复扫用于证明返修可重复；另在独立缓存核验获准验收时点的最新可用漏洞库。两组均记录 scanner digest/version、DB UpdatedAt/SHA-256、镜像/报告哈希、扫描包范围及严重等级；保留 R55 原库不覆盖。更新或下载漏洞库属于后续独立任务授权，不由本文触发。
- 2026-09-03 本地 PASS 仅适用固定 R55 库的 Critical/High；不声称所有等级或最新漏洞库为零。新的远端 RC 未经主控完整 G4-4 PASS 前，不得恢复 G4-5；绑定三个旧拒绝 RC 的历史部署任务卡不能复用。

## 6. 数据库迁移

### 6.1 原则

- migration 是一次性发布任务，不是 app/worker 的启动副作用。
- 生产迁移前必须有新鲜、可验证的数据库备份或恢复点。
- 迁移 SQL、回滚 SQL、checksum 和目标数据库必须在执行前复核。
- migration 成功并完成数据库核对前，不启动依赖新结构的新版本 app/worker。
- 禁止 app 与 worker 并发执行迁移。
- 禁止为了让 rollback 通过而清空业务 outbox 或其他业务事实。

### 6.2 权限

migration 使用临时或受控的最小 DDL 权限。完成后撤销临时账号或权限，并确认业务对象所有权回到获准的长期账号。app/worker 不持有长期超级用户或通用 DDL 权限。

### 6.3 失败处理

| 情况 | 动作 |
|---|---|
| 迁移尚未提交且失败 | 保持旧 app/worker，不继续发布；保存失败证据 |
| 迁移已提交但新版本未启动 | 按兼容性判断是否可继续使用旧版本；不能假设可直接回滚 |
| rollback 被数据安全保护阻断 | 停止；不得删除业务事实绕过保护；升级人工裁决 |
| schema 与镜像不兼容 | 停止 app/worker 启动；从备份、前向修复或获准回滚中选择 |

### 6.4 隔离验收基础资料的一次性 bootstrap

预生产隔离基础资料不是 migration，也不得由 app/worker 启动时自动写入。执行时必须满足：

- 只使用冻结包及其 ZIP、内部清单和业务内容 checksum；目标数据库、候选 revision、零标记数据和无运行 migration 必须先核对。
- owner 连接文件只在获准窗口内创建，权限为 `root:root 600`；不得进入 Git、镜像、常驻环境变量、日志或运行容器。
- 基础资料使用事务和 advisory lock 一次性写入；写入结果不明确，或已经写入但后置核验失败时，禁止整批重跑，先由 app 身份只读盘点实际数据。
- 核验只使用 app 长期身份；完成后立即轮换 owner 密码、确认旧凭据被拒绝并删除临时连接文件。
- 如果冻结兼容触发器改变派生字段，应保留失败现场并定位触发器行为；只能在单独批准下做最小字段修正，再重新执行 app 身份精确核验，不得借机改动其他业务字段。

2026-08-09 的 G3E2E R2.2 执行已按上述边界完成：`3` 个门店、`6` 个用户、`5` 名司机和 `8` 台车辆精确匹配，班次、位置与订单为 `0`，owner 已关闭。证据见 [G3E2E R2.2 隔离基础资料写入与核验](../../status/2026-08-09-gate3r-g3e2e-base-data-bootstrap.md)。该结果不授权在当前数据库重复执行 bootstrap。

## 7. app 与 worker 启动

### 7.1 app

- 只在 migration 成功后启动新版本。
- 由 Nginx 转发获准入口；应用端口不直接暴露公网。
- 启动后先验证匿名 liveness，再以受保护方式验证 readiness。
- readiness 失败不得纳入正式流量。

### 7.2 worker

- 第一版保持单副本。
- 无公共网络入口。
- 使用独立内部凭证调用受保护处理能力；秘密不得进入 URL 或日志。
- 启动后验证最后成功时间、连续失败数、outbox 积压、租约和日志脱敏。
- app 健康不代表 worker 健康，二者必须分别验收。

### 7.3 ECS 分阶段启动顺序

以下命令是受控执行模板，不构成迁移、部署或云资源变更授权。配置文件和镜像摘要复核通过后，必须逐步执行并在每一步满足停止条件：

```bash
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile migration --profile app --profile worker --profile edge \
  config --quiet
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile migration run --rm migration
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile app up -d app
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile worker up -d worker
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile edge up -d nginx
```

1. `config --quiet` 失败、出现未替换变量或非预期端口时立即停止；身份核验时仅对 `config` 显式选择全部 profile，并检查 app/worker/migration 都存在且指向同一批准 digest。未选 profile 得到空服务表不能算三角色核验通过；真实秘密配置不得整份输出或写入普通日志。
2. migration 失败、指纹不符或数据库核对失败时停止，不启动 app。
3. app readiness 未通过时停止，不启动 worker。
4. worker 日志、单副本约束或内部鉴权未通过时停止，不启动 Nginx。
5. Nginx 配置、HTTPS、安全组或外部健康检查未通过时停止，不开放流量。

裸执行 `docker compose up -d` 被设计为不启动任何业务服务；禁止使用 `--profile "*"` 一次性拉起全部角色。每个角色都必须锁定本轮批准的同一不可变镜像 digest。

### 7.4 2026-08-10 预生产发布事实

本节只登记已经完成的发布证据，不构成再次部署授权：

- 当前发布 commit 为 `958afca537b412fb972b6e180561a9b37022834d`；ACR index digest 为
  `sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`，amd64
  manifest 为 `sha256:04798acbaa142e97b5bc2cdba85d3852e5c0261da9a3368c9c6ba73e24127f87`。
- app 健康后才更新 HTTP-only 单副本 worker；二者镜像 digest、OCI revision 和运行环境
  `RCD_RELEASE_REVISION` 已核对一致。
- Nginx 只重建一次容器以刷新同一 `RCD_RELEASE_REVISION`；原 Nginx 镜像、Compose 配置、
  自签名证书和端口保持不变，不得把它写成 Nginx 镜像升级。
- 未执行 migration，未重复写入 G3E2E 基础资料，未清理任何首轮或重验失败样本。
- 冻结真实 10 单已通过：9 单完成，订单 7 按预期不可行并生成开放预警；A/B/C、并发、
  手动改排和接入幂等均取得证据。当前运行基线保持不变，仅放行故障注入与应用回退。证据见
  [2026-08-10 真实 E2E 重验进度](../../status/2026-08-10-gate3r-real-e2e-retest-progress.md)。

### 7.5 2026-08-10 应用回退事实

- app → worker → Nginx 按冻结顺序回退到
  `084649f498c7bce3c1418c2a5d9273282b085efc@sha256:4664fc50cbd1a6bf08e24e99447d2f03097e3d21a74fcdaa80d2c2c432b05947`，
  三容器 revision、app/worker digest、单 worker、liveness/readiness、db/redis/amap、HTTPS、
  outbox 与冻结 10 单执行状态通过，用时 30 秒。
- 随后按相同顺序恢复
  `958afca537b412fb972b6e180561a9b37022834d@sha256:13e0f3c4c10599867bc8a956f9332890826edcebdbc00cef9ec826fca2415bff`，
  同一检查再次通过，用时 31 秒。
- Nginx 两阶段均使用原 `nginx:1.27-alpine`、配置、证书和端口，只重建容器刷新 revision。
- 未执行 migration、基础资料写入、直接数据库写入或清理；完整证据见
  [故障注入与应用回退验收](../../status/2026-08-10-gate3r-fault-rollback-acceptance.md)。

## 8. Nginx、域名与 HTTPS

- 域名解析变更、证书签发和 Nginx 配置必须先在预生产或等价隔离环境验证。
- 中国大陆正式公网域名在切换生产流量前必须核验适用的 ICP 备案/许可状态；未完成不得宣布正式上线。
- 只开放必要协议和端口，HTTP 应按获准策略跳转 HTTPS。
- Nginx 只做入口、TLS、转发、体积/超时等基础保护，不代替应用鉴权。
- 真实客户端 IP 头、请求 ID/trace 传递和日志字段必须受控，不能信任任意外部伪造头。
- 证书到期必须进入运维告警。

具体域名、证书路径、端口、云负载均衡和 Nginx 命令在资源盘点完成后补充到受控实施步骤，不写入本次未核验初稿。

## 9. 环境变量与秘密

文档只登记变量名称和职责，不保存值。至少分为：

| 类别 | 示例职责 |
|---|---|
| 数据库 | app 业务连接、migration 迁移连接；不得默认共用超级权限 |
| Redis/Tair | 实时数据和锁连接 |
| 应用会话 | 管理员会话签名 |
| 司机鉴权 | 司机 JWT 签名和有效期校验 |
| ingest | 每个凭证绑定唯一来源 |
| worker | 内部 worker 独立秘密和目标内部地址 |
| 高德 | 服务端 API、浏览器 JS Key/Security Code |
| CORS | 明确来源白名单 |
| 日志 | 级别、环境、采集标识 |
| 发布追溯 | 完整 `RCD_RELEASE_REVISION`；不得使用短 SHA、tag 或镜像地址代替 commit 身份 |

发布前只记录“已配置/缺失/轮换日期/责任人”，不得输出真实值。

预生产订单接入凭证当前按来源拆分：既有通用 ingest 凭证继续绑定 `HALUO`，独立
`INGEST_API_KEY_API` 只绑定 `API`。两个凭证不得互相投递来源；文档、日志和证据只记录
变量名、绑定来源、是否存在及长度校验，不记录密钥值。该变量仅由 app 使用；单独轮换或
补充 API ingest 凭证时，只允许重建 app，不得因此重建 worker、Nginx 或运行 migration。

## 10. 健康检查与发布验证

- 匿名 liveness 只证明进程可响应，不公开数据库、Redis 或高德细节。
- readiness 受保护，检查应用运行所需依赖；其 HTTP 契约以 API 契约 V2 为准。
- 发布验证至少包括：app liveness、app readiness、worker 周期成功、outbox 可处理、数据库迁移记录、Redis/Tair 连接、结构化日志、登录面安全和关键业务只读/受控冒烟。
- 构建通过不等于真实依赖已验收；外部依赖未配置时的降级构建日志不能冒充生产验证。

## 11. 回退策略

### 11.1 应用回退

当数据库结构保持向后兼容时，可把 app/worker 回退到上一获准镜像 digest。必须同时记录回退原因、时间、操作者、目标 commit 和验证结果。

### 11.2 数据库回退

数据库回退不是应用镜像回退的附属动作：

- 有业务事实写入后的破坏性 rollback 必须默认阻断。
- 优先使用兼容发布、前向修复或恢复到隔离库验证。
- 只有在数据影响、备份、恢复点和回滚 SQL 全部确认后才可操作生产。

### 11.3 配置回退

配置和秘密回退必须使用受控版本，不能从聊天记录、截图或个人终端历史复制。安全事件中的旧秘密不得恢复使用。

## 12. 灰度与维护窗口

第一版已批准采用单 ECS，只能使用明确维护窗口或短暂停机发布，不能声称无损滚动。多实例灰度需要负载均衡、会话、数据库连接、worker 唯一性和版本兼容验收后另行批准。

具体维护窗口、通知对象和允许中断时长延后到资源盘点与实施步骤确定；未确定前禁止生产部署。

## 13. 强制停止规则

出现以下任一情况立即停止发布：

- 构建来源不是已批准 commit；
- 镜像 digest 与发布记录不一致；
- 备份或恢复点不可验证；
- 迁移目标库无法确认；
- migration 失败或结果无法核对；
- app readiness 失败；
- worker 连续失败或没有成功证据；
- 需要开放全网数据库/Redis 白名单才能继续；
- 中国大陆正式公网入口所需的 ICP 备案/许可或证书尚未通过核验；
- 需要把秘密写入 URL、日志、镜像或 Git；
- 需要清空业务数据绕过回滚保护；
- 发现文档与 PRD、数据架构、API 或兼容矩阵冲突。

## 14. 发布证据包

每次发布至少保存：

- commit SHA、分支和审查记录；
- ACR 镜像标签与 digest；
- 上一稳定镜像；
- 目标环境和资源脱敏标识；
- 备份/恢复点状态；
- migration checksum、开始/结束时间和结果；
- app/worker 版本、健康检查和关键冒烟结果；
- 集中日志查询证据；
- 回退条件和责任人；
- 未完成项与停止决定。

## 15. R7 冻结与实施前置

- 第一版采用单 ECS 和明确维护窗口，不采用多实例灰度；
- 具体允许中断时间、通知对象、正式域名、证书管理、秘密托管、ACR/ECS/流水线实施方式、观察窗口和责任人在资源盘点与实施步骤确定；
- 上述实施项未完成前，本文虽已冻结，也不得执行正式生产部署。

## 16. 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| V2.0 | 2026-07-30 | Gate 3-R R7 部署与回退基线冻结 |
| V2.0-r1 | 2026-08-02 | 冻结 ECS/Docker 权限边界与 migration → app → worker → edge 分阶段启动顺序 |
| V2.0-r2 | 2026-08-02 | 每条受控 Compose 命令均显式携带 `--env-file` 与 `-f deploy/compose.preprod.yml`，禁止依赖命令间隐式继承 |
| V2.0-r3 | 2026-08-08 | 冻结完整运行 revision 与镜像身份一致性；登记 `4eb3b485...@sha256:9ec826...962f` 的 app/worker/Nginx 分阶段更新和本机日志护栏验收，SLS 与回退仍待实施 |
| V2.0-r4 | 2026-08-09 | 登记 LoongCollector、SLS 运行/安全日志、查询、脱敏、留存、告警、通知与预算验收通过；部署顺序、镜像、migration 和回退规则不变 |
| V2.0-r5 | 2026-08-09 | 登记 G3E2E R2.2 一次性隔离基础资料 bootstrap、app 身份精确核验、兼容触发器派生字段最小修正与 owner 再次关闭；禁止不明状态下整批重跑 |
| V2.0-r6 | 2026-08-09 | 登记独立 `API` ingest 凭证与既有 `HALUO` 凭证分离；本轮只重建 app，worker/Nginx 容器保持不变，未执行 migration 或基础资料写入 |
| V2.0-r7 | 2026-08-10 | 登记 `958afca…@sha256:13e0…5bff` 的 app/worker 分阶段发布与 Nginx revision-only 刷新；未执行 migration、基础资料写入或失败样本清理，真实 10 单部分通过 |
| V2.0-r8 | 2026-08-10 | 登记冻结真实 10 单通过并放行故障注入与应用回退验收；既有分阶段顺序、回退目标和禁止 migration/基础资料/清理规则不变 |
| V2.0-r9 | 2026-08-10 | 登记 `084649f4…` 分阶段回退 30 秒和 `958afca…` 恢复 31 秒通过；Nginx 原镜像/配置/证书/端口、Schema、migration 和基础资料不变 |
| V2.0-r10 | 2026-08-10 | 最终一致性审查确认 GitHub 远程 `958afca…`、ACR index digest `sha256:13e0…5bff`、amd64 manifest、ECS app/worker 镜像与三服务 release revision 一致；未重新构建、部署或执行 migration |
| V2.0-r11 | 2026-08-10 | 登记文档基线 `feature/v2-gate3-review-remediation @ 57ef86c…` 已提交、推送并完成本地/upstream/GitHub 远程核验；应用发布、回退与禁止 migration 规则不变 |
| V2.0-r12 | 2026-08-11 | 登记 Gate 3 最终 `PASS`；不可变镜像、分阶段发布、回退目标和禁止重复 migration/基础资料规则不变，第二轮部署仍需单独授权 |
| V2.0-r13 | 2026-08-11 | 登记 Gate 3 PASS 文档内容基线 `464ee5d…` 已提交、推送并完成三方核验；运行镜像、部署、回退与 migration 边界不变 |
| V2.0-r14 | 2026-09-03 | 落实 APP-006 无 shell runner/Node 入口、Git 归档与 19/19 SQL raw 指纹；区分本地 R55 PASS、远端双扫描和 G4-5 重新授权，补全 Compose config-only profile 核验 |

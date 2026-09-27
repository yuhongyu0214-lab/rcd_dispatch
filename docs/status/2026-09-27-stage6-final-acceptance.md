# Stage 6 预生产最终验收与范围裁决

> 文档类型：`STATUS / ACCEPTANCE_RECORD`
> 状态：`STAGE6_FINAL_PASS_WITH_USER_ACCEPTANCE_EXCEPTIONS`
> 生效日期：2026-09-27；治理版本：R73
> 权威范围：本轮预生产的验收事实、用户范围裁决、证据索引和交付边界
> 非权威范围：产品行为、HTTP 契约、Schema、基础设施架构及未来发布授权
> 本轮授权：用户明确回复“提交并更新文档”，仅授权 A8 文档同步；治理提交、推送、合并和新的外部操作均须分别授权

## 1. 最终结论

Stage 6 **通过，按用户批准的验收范围及例外收口**。对象为现有[预生产站点](https://101.133.147.166)。最终最小只读运行检查 17/17 通过，独立证据复核通过，本轮剩余验收项为 0；没有新增已证实的 P0/P1。既有非阻断 P2 不因本结论自动删除。

这意味着本轮预生产部署、入口修复和已接受的业务体验完成验收，不等于正式生产发布。用户已明确不再重复人工派单、注册/纯司机入口及页面数值测量；具体依据见第 4 节。

## 2. 代码、镜像、文档与证据分开冻结

| 对象 | 身份 |
|---|---|
| 已验收代码 / app、worker OCI revision | `781a797c3286c0a5b134a010660a0e85633216fe` |
| app、worker、Nginx release revision | `781a797c3286c0a5b134a010660a0e85633216fe` |
| app / worker 镜像 index | `sha256:82ff43b17a7392b0187e281820a71c2d3557a1506fbd98dad1200ef31f530b1d` |
| amd64 manifest | `sha256:dd01f7cbd47699170ef97da0a9e1b3e420ff0ff2a23b736d9665bc2c6ad8acda` |
| image config | `sha256:c5731f40b28b7a63038561c085cb8acbd56df2214d49df460a394879eb32e800` |
| Nginx 原镜像 | `nginx:1.27-alpine`；`sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8` |
| 登录返修来源 | `feature/v2-login-workspace-selection @ 781a797…`，7 个入口、首页和测试文件 |
| A8 起始文档基线 | `4868fe53daf37b3c0e9aa6a80a60820355831063`（R72） |
| 本轮治理结果 | R73 由承载本记录的治理提交冻结，完整 SHA 以该 Git 提交身份为准；不得把代码 RC 或证据哈希当成文档提交 SHA |
| 上一预生产 / 回退身份 | `40b4a0fca3c9f9b4cfd392341f89663fdbbcb418` / `sha256:0dc8315fb56361fa5afa04cab43d9c890f9c78e882c88070afa3a764dd450e09` |

R72 曾核验 `main/origin/main @ 85bcfa534e5a3525f2bf84e0628bac4942559120` 和 `develop/origin/develop @ 14537ddaf92182b2f68308e66503d262490ce1e1`。这是历史主线记录，本轮没有重新查询远端，也没有把 `781a797…` 合入主线。后续交接须分别冻结代码、文档和镜像，不能把新运行版本与旧主线提交混为一谈。

## 3. 部署与最终运行结果

登录返修的本地工程证据为 1002 passed / 7 expected skipped、相关专项 152 项、lint、TypeScript 和 32/32 build 通过。固定镜像扫描 Critical/High/Secrets 为 0，19 项 SQL 与冻结来源一致；该结论只绑定当时扫描的固定制品。本次 Stage 6 / 登录返修没有新增 Schema 或执行 migration。

首次发布在 Nginx 对齐时失败，自动回退未全部完成；受控恢复已核验旧 app、单 worker 与 ACME webroot。第二次以 `NGINX_BOUNDARY_CHANGED` 停止并成功回退；缺少该次新 mounts 的完整原始现场，不能把具体原因追认成已完全证实的排序差异。第三次先完成只读边界预检，采用保留原始字段的规范化比较，在不放宽挂载/端口边界的前提下完成发布。失败、恢复与回退目录均保留。

R3 发布记录于 `2026-09-27T04:08:06.199740Z` 完成。app → 单 worker → 15 分钟观察 → Nginx revision 对齐完成；最终业务验收随后单独进行，不用部署完成状态代替业务验收。

最终检查时间：北京时间 **2026-09-27 15:46:16—15:46:17**（UTC `07:46:16.274132—07:46:17.891649`）。

| 最终只读检查 | 结果与边界 |
|---|---|
| 运行身份与固定镜像 | app、worker 和 Nginx release revision 一致，app/worker 镜像符合固定对象 |
| app / worker | 均 running、healthy；运行 worker 恰为 1 |
| Nginx | running、配置语法通过；未配置 Docker healthcheck 为既有状态，不误写为 healthy |
| 最近 15 分钟 worker | 成功周期 15，已检查失败事件 0，日志未截断；来源为 Docker logs，不是本次新 SLS 查询 |
| 数据库 outbox | `rcd_v2_preprod` 的 pending / failed / eligible / locked 均为 0 |
| readiness | HTTP 200、success=true，db / redis / amap 全部 ready |
| 可信 HTTPS | health 与 login 均 HTTP 200，未跳过证书校验 |
| 稳定性 | 检查前后容器 ID 不变 |
| 汇总 | 17/17 true，`runtimeResult=PASS`，`failedChecks=[]` |

该检查由用户在 Workbench 执行并回传完整结果，本地核对及独立复核通过。最终检查未写业务数据、未改配置、未部署或重启；运行结论对应上述时间点和日志窗口。

## 4. 已接受的业务证据与用户例外

| 项目 | 最终采用依据 | 不扩大的证据边界 |
|---|---|---|
| 登录入口返修 | 用户确认 iPhone Safari、华为 Mate 50 Pro、独立 Chrome 和 Edge 正常；普通调度员登录先显示双工作台按钮，选择司机工作台可进入 `/driver/tasks` | 不是纯司机账号新增实测 |
| 真机定位、模块重排和执行体验 | 保留既有 iPhone 与华为截图、用户操作反馈和只读业务证据 | 原订单、操作和失败样本保留，不通过重置数据补证 |
| 人工派单 | `PASS_BY_USER_ACCEPTANCE_OF_PRIOR_VERIFICATION`：用户明确认可此前验证，不再复测 | 沿用用户认可的历史结果，不补造新的人工派单成功日志 |
| 受邀注册 / 纯司机入口 | `PASS_BY_USER_SCOPE_EXCEPTION`：用户明确接受并免于进一步验收 | 注册预检因手机号已有历史司机而停止，无新成功注册、发邀请码或纯司机登录实测声明 |
| 页面尺寸与布局 | `PASS_BY_USER_ACCEPTANCE_OF_REAL_DEVICE_EXPERIENCE`：接受过往 iPhone Safari、华为横竖屏实际体验，按钮完整可见 | 外部网站 DPR 3.13 / 388×692 不是司机页面的新增尺寸测量；不要求补测 |
| 当前版本三服务 SLS | 截图样本 + 用户报告 app 245、worker 212、Nginx 181 条，均为 `781a797…`，收集与查询项通过 | 不是区间内所有请求均成功、所有错误均为 0 的声明 |

登录默认行为按 [PRD §9.1.1](../versions/v2.0/prd-v2.md#911-默认入口与-v1-正常入口退场2026-09-13-用户裁决)及 [APP-009](../versions/v2.0/application-decision-log.md#app-009按角色选择默认登录工作台与-stage-6-收口)记录：历史 `driver` 默认 H5，`admin` / `dispatcher` 默认工作台选择页，安全的显式站内 next 保留。共享双端能力与 H5 本人任务限制不变。

既有非阻断 P2 继续登记：隐藏兼容工具内可切换旧模式、注销请求失败缺少明确反馈；历史证据包外部原始资料未完整入包等证据限制不因本轮裁决消失。没有把这些事项升级为本轮重复测试要求。

## 5. 可追溯证据

| 证据 | 位置 / 校验 |
|---|---|
| 远端最终只读报告 | `/srv/rcd-dispatch/backups/stage6-account-entry-20260917T100509Z/login-entry-release-781a797-r3/final-minimal-readonly-20260927T074617Z-ebb6f229.json` |
| 最终只读报告 SHA-256 | `4ff3105af777e687612cca6e036b24105fd325c975b4a4da1c9117d6a75c827e` |
| 本地最终验收包 | `C:\Users\yhy\AppData\Local\Temp\rcd-stage6-reviewed\stage6-final-acceptance-20260927T074617Z.zip` |
| ZIP SHA-256 | `6268930bf969ef589aa12afa7b670710d411195dad171109d1e526a4f6c0a502` |
| 包内索引 | `final-acceptance.json`、`final-independent-review.json`、`user-acceptance-decision.json`、`runtime-report.json`、`source-index.json`、`sha256-manifest.json`，以及浏览器 / SLS 材料；清单包含 22 个文件哈希 |
| 历史构建制品 | `D:\CodexBuild\rcd-login-781a797` |
| 远端发布 / 回退记录 | `/srv/rcd-dispatch/backups/stage6-account-entry-20260917T100509Z/login-entry-release-781a797-r3` 及同级 `login-entry-release-781a797`、`login-entry-release-781a797-r2` |

完整回传 JSON 按原格式重建后，SHA-256 与用户报告一致；这是回传内容核验，没有声称直接下载了远端原文件。ZIP 哈希和包内清单已校验。本包是**收口证据选集**，不是全部历史资料归档；外部原始资料继续保留在来源位置。临时目录不是新的长期制品库，后续迁存需保持字节和校验值不变。

原始运行报告的 `stage6FinalPass=false` 保持原样，表示采集器等待阶段裁决；审查后的 `final-acceptance.json` 单独记录 `stage6FinalPass=true` 和本页最终结论，不篡改原始采集结果。

## 6. A8 同步与下一步

本轮仅同步受影响的状态、产品入口说明、应用决策、部署记录、版本入口、公共上下文和 Canvas；HTTP 契约、架构与运维文档只纠正部署状态并指向本报告，未改变接口或架构规则。旧阶段按日期保留为历史。

代码 RC 维持 `781a797…`，起始文档基线为 `4868fe5…`，证据包哈希单独登记。A8 本身不授权治理提交、推送、合并、部署、云资源或数据库操作；只有承载本记录、经过单独授权并核验的完整 Git 提交 SHA，才能作为 R73 的不可变文档基线。

Stage 6 无剩余补测项。下一工作若为代码主线交接或正式生产准备，应另立任务并冻结对应基线、范围和授权，不继承已消费的预生产操作权限。

大白话：这轮预生产验收已经完成，文档写清了实际测过的内容和你同意不再重测的内容。此次只是把这些结论记入项目资料，没有再次改服务器、订单或账号，也没有自动提交或推送 Git。

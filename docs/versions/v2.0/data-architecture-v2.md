# 人车单数据架构说明 V2

> 架构版本：`RCD-DATA-V2.0-R14-20260803`
> 状态：架构口径冻结；Gate 3 应用候选包含 9 个内容固定的 migration
> 目标：当前 RDS 可运行，未来替换外部 API 时迁移代价最小
> 代码事实：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`

## 1. 白话结论

外部公司只负责告诉我们“订单是什么”；人车单系统负责决定“谁什么时候去做、怎么衔接、是否会迟到、实际做了多久”。

因此未来外部数据库或 API 变化时，只更换入口翻译器，不更换系统大脑。

```text
外部 API / 浏览器插件 / 临时 RDS
              ↓
      OrderSourceAdapter（翻译和验货）
              ↓
        CanonicalOrder（内部标准订单）
              ↓
  PostgreSQL：订单快照 + 调度 + 执行 + 日志
       ↙              ↓              ↘
Redis/Tair          高德           Web/司机端
实时位置/缓存      地图与 ETA      只调内部 API
```

## 2. 稳定边界和数据所有权

| 层 | 拥有什么 | 更换外部 API 时是否变化 |
|---|---|---|
| 外部订单源 | 外部订单号、时间、地点、车辆快照、原始状态 | 会变化 |
| Adapter | 校验、字段映射、幂等、版本兼容、错误隔离 | 主要变化点 |
| CanonicalOrder | 内部统一订单字段 | 原则上不变，只能兼容扩展 |
| 内部 PostgreSQL/RDS | 订单快照、排程、执行、预警、日志 | 不变 |
| 调度引擎 | A/B/C、锁定、时间窗、30 分钟约束 | 不变 |
| Redis/Tair | 实时位置、在线状态、ETA 缓存、短锁 | 不变 |
| 高德 | 地理编码、路径、ETA、导航和地图 | 不变 |
| Web/司机端 | 内部 API 的展示与操作 | 不因外部字段变化而改 |

外部公司拥有订单主数据；人车单系统拥有调度、模块、执行、定位引用、预警和日志。外部 API 不得直接写内部调度字段，也不得覆盖内部执行历史。

## 3. CanonicalOrder V2

外部字段名可以不同，但进入引擎前必须映射为内部标准字段。

### 3.1 必填字段

| 内部字段 | 类型 | 说明 | 当前 V1 对应 |
|---|---|---|---|
| `sourceSystem` | string | 冻结枚举：`HALUO / PLUGIN / API / V1_IMPORT`（`V1_IMPORT` 仅迁移回填及 V1 写兼容窗口使用）；外部渠道名由 Adapter 规范化 | `channel/source` |
| `externalOrderId` | string | 来源内唯一 ID | Adapter 已有，Order 尚未持久化 |
| `orderNo` | string | 用户可见订单号 | `Order.orderNo` |
| `sourceVersion` | string | 外部版本或更新时间 | V2 新增 |
| `businessType` | enum | 锁定沿用 V1 值：`STORE_PICKUP / STORE_RETURN / DOOR_DELIVERY / DOOR_PICKUP` | `Order.type` |
| `promisedPickupAt` | datetime | 承诺取车时间 | 当前 `scheduledAt` |
| `pickupAddress` | string | 取车地址原文 | 已有 |
| `deliveryAddress` | string | 送达地址原文 | 当前 `returnAddress`，V2 统一语义 |
| `storeCode` | string | 归属门店编码 | 当前通过 `storeId` 关联 |
| `sourceStatusRaw` | string | 外部原始状态；仅持久化到 `OrderSourceEvent`，`Order` 快照不保存（存储边界冻结，见 §2 所有权与 API 契约 §2.3） | V2 新增 |
| `receivedAt` | datetime | 必填；由服务端接收时生成，UTC 存储，不接受外部传入 | V2 新增 |

### 3.2 可选字段

| 内部字段 | 处理 |
|---|---|
| `pickupLat/pickupLng` | 有则校验；无则由后端高德地理编码 |
| `deliveryLat/deliveryLng` | 同上 |
| `licensePlateSnapshot` | 只展示，不参与 V2 匹配 |
| `vehicleTypeSnapshot` | 只展示，不参与 V2 匹配 |
| `storeName` | 展示与门店解析 |
| `city/district` | 辅助地理编码和城市校验 |
| `remark` | 订单备注 |
| `cancelledAt` | 外部取消时间 |

### 3.3 唯一键与版本覆盖（冻结）

```text
Order 唯一键：(sourceSystem, externalOrderId)      —— 一个外部订单只有一条内部快照
Event 唯一键：(sourceSystem, externalOrderId, sourceVersion) —— 即幂等键
```

- 相同版本重复到达：不重复写入，返回已有处理结果（`replayed`）。
- 新版本到达：更新订单快照，生成来源事件和变更日志。
- **旧版本晚到**（`sourceVersion` 小于订单快照当前已存版本）：不覆盖快照，计入 `skipped`（reason `STALE_VERSION`），仍记录一条来源事件供追溯。
- `sourceVersion` 必须可按字符串字典序比较新旧，冻结两种合法格式：**UTC `Z` 结尾、固定毫秒精度的 ISO 8601**（`YYYY-MM-DDTHH:mm:ss.sssZ`）或**零填充定长递增序号**。带非 `Z` 时区偏移的 ISO 字符串不得直接比较——各来源 Adapter 必须先统一转换为上述格式再落库；无法转换的来源在 Adapter 内整批拒绝。
- **保留值例外（冻结）**：上述两种格式只适用于 V2 在线投递。Gate 1 存量迁移及 V1 写兼容窗口固定使用保留值 `"v1-migration"`，并继续按来源映射保存 `HALUO / PLUGIN / V1_IMPORT`；该值不得由 V2 在线 ingest 传入。版本比较器必须把它视为低于任意合法在线版本的迁移基线，不得直接参与字符串字典序比较。
- `orderNo` 仅为用户可见订单号，不设唯一约束，也不能单独作为幂等键；不同来源允许重号。
- 来源投递的输入信封（`IngestEnvelope`）结构冻结见 API 契约 V2 §2.3。

## 4. Adapter 契约

每个订单源实现：

```text
validate(raw) → normalize(raw) → map(raw) → CanonicalOrder
```

必须遵守：

- 校验必填、时间、枚举、坐标和字符串长度。
- 保存来源标识、原始状态和原始 payload 摘要。
- 外部枚举只能在 Adapter 内转换，调度引擎不得识别外部字段名。
- 单条失败不阻断整批，返回逐条错误和 traceId。
- 未知可选字段可保留在原始 JSON，但不得扩散到业务代码。
- CanonicalOrder 只允许向后兼容增加可选字段；删除或改义必须升级 major 版本。

## 5. 最小数据模型

以下是逻辑模型。物理结构必须在 `data-model-v2` 阶段通过 Prisma 迁移实施，本文件不直接修改 schema。

### 5.1 保留并扩展的现有实体

| 实体 | 保留内容 | V2 变化 |
|---|---|---|
| `Order` | 订单号、类型、地址、坐标、时间、快照 | 增来源 ID/版本、承诺时间语义、可行性；**不保存**外部原始状态（`sourceStatusRaw` 仅存 `OrderSourceEvent`） |
| `Driver` | 人员、门店、状态、最近位置 | 增当班状态、可用性（`AVAILABLE / UNAVAILABLE`）、计划版本 `planVersion`（司机计划聚合根，见 §6）和位置有效性；S1-S4 后续兼容迁移 |
| `Assignment` | 订单与司机关系、历史链 | 增顺序、计划时间、锁定和执行事件（`planVersion` 不在 Assignment 上，见 §6） |
| `OperationLog` | 操作人、动作、metadata | 扩展自动重排、模块修改、字段修改、预警处理 |
| `GeocodeCache` | 地址与坐标缓存 | 保留 |
| `Vehicle` | 车辆及订单快照关联 | 保留展示，从调度约束中移除 |

### 5.2 新增实体（冻结；Gate 1 必须实施，物理命名与索引由 Gate 1 定稿）

| 实体 | 用途 | 设计理由 |
|---|---|---|
| `OrderSourceEvent` | 来源、外部 ID、版本、接收结果、原始 JSON 摘要 | 幂等、追溯和 API 联调 |
| `DriverShift` | 上下班时间和当班状态 | 是否参与调度不能只靠位置判断 |
| `OrderServicePlan` | 五个模块选择、总时长、修改版本 | 用受控枚举 + JSONB，避免五张配置表 |
| `DispatchAlert` | 不可行预警、处理状态（`OPEN / RESOLVED`）、解决方式 | 预警需持续展示，不能只写日志 |
| `DriverLocationSample` | 按§7.1 冻结口径采样的历史位置 | Redis 只存最新位置，不能事后追溯 |
| `DispatchEventOutbox` | 业务事实触发调度的事务型事件队列、消费租约、重试状态 | 事件与来源业务事实同事务写入，避免提交后进程中断导致漏排；不复用 `OrderSourceEvent` |

为保持精简，V2 不建立“模块字典表”和“全天排程表”。A/B/C 由有效 Assignment 的计划顺序派生。

`OrderSourceEvent` 只保存外部订单来源事实，`sourceSystem` 仍严格限定为
`HALUO / PLUGIN / API / V1_IMPORT`。内部调度事件不得伪装成订单来源，
也不得为此扩展外部来源枚举。

## 6. Assignment V2 关键字段

| 字段 | 用途 |
|---|---|
| `sequenceNo` | 司机当前计划顺序；前三个有效项派生 A/B/C |
| `plannedDepartAt` | 计划出发时间 |
| `plannedPickupAt` | 预计到达取车点时间 |
| `plannedCompleteAt` | 模块 + 工单 ETA 后的预计完成时间 |
| `deadheadEtaMinutes` | 前序位置到本单取车点 ETA |
| `serviceEtaMinutes` | 取车点到送达点 ETA |
| `lockType` | `NONE/AUTO_FROZEN/MANUAL_LOCKED` |
| `departedAt` | 点击出发 |
| `arrivedAt` | 点击到达，实际计时起点 |
| `completedAt` | 点击完成，实际计时终点 |
| `lastEtaCalculatedAt` | ETA 计算时间 |

A/B/C 是展示和算法概念，不建议永久写死为唯一状态；按同一司机有效 Assignment 的 `sequenceNo` 计算，避免改派时批量改槽位枚举。

**`planVersion` 归属（冻结）**：`planVersion` 是司机计划聚合的乐观锁版本号，每名司机一个计数器，持久化在 `Driver`（计划聚合根）上，不存在于单个 Assignment。该司机计划的任何变化（自动重排、分配、改派、撤回、取消释放、解锁、下班或不可用释放）均递增一次。改派同时改变两名司机的计划，因此改派命令携带 `expectedFromPlanVersion` 和 `expectedToPlanVersion`，两者在同一事务中校验并各自递增。

**版本携带规则（封闭式，冻结，与 API 契约 §1.6 一致）**：**只有**计划编辑命令（分配/改派/撤回/解锁）要求客户端携带 `expected*PlanVersion`；**除此之外**的所有业务事实、控制命令和系统重排触发（取消、可用性设置、上下班、出发/到达/完成、订单资料修改、服务模块修改、位置变化、订单接入、周期基线校验等）均不携带客户端版本，由服务端对受影响订单和司机取短锁，在事务内读取、校验并递增受影响司机的 `planVersion`。

## 7. 实时数据与持久数据

| 数据 | Redis/Tair | PostgreSQL/RDS |
|---|---|---|
| 司机最新位置 | 主存，短 TTL | 按策略采样、最近位置兜底 |
| 在线状态 | 主存，短 TTL | 上下班记录和最后在线时间 |
| ETA | 30–120 秒缓存 | 只保存用于排程或审计的结果 |
| 调度短锁 | 5–15 秒 | 最终 Assignment 用事务提交 |
| A/B/C 结果 | 可缓存快照 | Assignment 是事实来源 |
| 操作和预警 | 可做通知缓存 | 必须持久化 |
| 调度触发事件 | 不存业务事实 | `DispatchEventOutbox` 持久化，至少一次消费 |

Key 命名为**非契约示例**（Gate 1 定稿具体命名）；各 Key 的语义、TTL 范围和“Redis 只存实时/短期数据”边界是契约：

```text
driver:last_location:{driverId}
driver:online:{driverId}
eta:{originHash}:{destinationHash}:driving
dispatch:lock:{driverId}
order:lock:{orderId}
dispatch:snapshot:{driverId}:{planVersion}
```

### 7.1 位置有效性与采样口径（冻结）

按当前前台 H5 能力冻结以下数值：

| 口径 | 冻结值 |
|---|---|
| 前台当班目标上报间隔 | 30 秒，最长不超过 60 秒 |
| 接收即过期（拒收） | 样本到达时 `capturedAt` 已早于服务端时间 120 秒以上：拒收不入库，reason `EXPIRED_AT_RECEIPT` |
| 位置老化过期（STALE） | 已接收的最新位置随时间推移 `capturedAt` 距当前超过 120 秒：标注 `STALE` 并排除调度，不删除数据 |
| 位置无效 | 定位精度大于 100 米：拒收，reason `ACCURACY_TOO_LOW` |
| 时钟校验 | 客户端时间超前服务端 30 秒以上：拒收，reason `CLOCK_SKEW` |
| Redis 最新位置 TTL | 180 秒 |
| PostgreSQL 采样条件 | 距上次落库满 120 秒、移动超过 200 米、或发生出发/到达/完成/上下班事件，任一满足即保存 |
| 历史位置保留 | 默认 90 天 |

H5 进入后台后不承诺持续定位；超过 120 秒自然转为 `STALE`。不得拿旧位置冒充实时位置。“拒收”只针对新到样本，不影响已接收位置按老化规则转 `STALE`。

### 7.2 ETA 缓存与重算口径（冻结）

| 口径 | 冻结值 |
|---|---|
| ETA 缓存 | 默认 60 秒；允许范围 30–120 秒 |
| 重排触发阈值 | 每次真实 ETA 重算与上次有效值比较，绝对变化超过 10 分钟触发局部重排 |
| ETA 计算时机 | 原始 30 秒位置上报不必次次调用高德；司机移动达到 200 米、缓存到期、业务事件（出发/到达/完成/订单变化/班次变化/模块变化）或 10 分钟基线校验时再计算 |

实现边界：通过校验且时间更新的样本始终更新最新位置高水位；历史位置继续按
首次样本、移动超过 200 米或距上次历史样本满 120 秒落库。调度触发独立按
首次样本、移动超过 200 米或 ETA 缓存到期判定。触发时必须在同一事务内递增
司机 `planVersion` 并写入 `DRIVER_LOCATION_UPDATED` outbox；满足历史采样条件
时一并保存样本。提交后先更新实时位置缓存，再即时消费事件。其余约 30 秒样本
不触发完整重排。

## 8. 高德调用边界

- 地址首次进入或变更：地理编码。
- Gate 3 正确性优先：司机当前位置、既有 A/B/C 时间轴的 delivery cursor，
  以及计划池全部订单的 `deliveryLocation` 都属于必算 deadhead 起点；预计算
  全部必要的 delivery→pickup 组合，保证本轮 A 槽完成后生成的 cursor 可继续
  规划 B/C。未来降低调用量须另行冻结能感知 `(driver, slot, cursor)` 的候选预筛，
  不得用固定 Top-N 截断可能被核心使用的起点。
- 出发：用手机位置到当前工单取车点开启导航并刷新 ETA。
- 到达：记录实际时间；后续计划起点先按预计送达位置计算。
- 完成：用手机实时位置作为下一工单 ETA 起点。
- 高德失败：标记 ETA 不可用并进入人工判断，不允许填演示数字或假 ETA。

## 9. 重排一致性

1. 订单、位置、班次或执行状态变化时，在写业务事实的同一数据库事务中写入 `DispatchEventOutbox`；稳定 `eventId` 唯一去重。
2. 提交后由即时消费或受保护的周期补偿任务领取事件；消费失败保留事件并退避重试。
3. 为受影响司机和订单取得 Redis 短锁；Redis 不可用时降级为数据库行锁与版本校验，不伪造已取得锁。
4. 读取每名受影响司机的 `planVersion`、锁定和执行状态。
5. 计算候选 A/B/C 与真实 ETA。
6. 在数据库事务中再次锁定订单/司机行并验证各司机 `planVersion` 未变化。
7. 写入 Assignment 顺序、计划时间、可行性、预警和日志，每名受影响司机的 `planVersion` 只递增一次。
8. 提交成功后标记 outbox 事件已处理并释放短锁；版本已变化则重读快照重算，不能覆盖新计划。

版本已变化时放弃旧计算并重新排，不允许最后写入者无条件覆盖。

G3-3 细化：司机位置、班次或 Assignment 事件的局部范围以受影响门店为候选
边界，必须加载门店内全部活动司机进行比较，不得只加载触发司机。outbox
至少一次重试产生与当前持久计划完全相同的逻辑结果时，保留原 Assignment，
不重复回收/创建、不重复写计划日志、不递增 `planVersion`；计划时间、槽位或
真实 ETA 任一变化时仍按正常计划变更提交。worker 只有在 `lockToken` 仍归自己
所有时才能把事件计为 `processed`。

## 10. 外部 API 迁移流程

```text
取得样例和字段说明
→ 建 API Adapter
→ 对照 CanonicalOrder 校验
→ 影子写入/双读比对
→ 核对订单数、字段、坐标、时间和取消状态
→ 切换来源开关
→ 保留旧入口回滚窗口
```

迁移成功标准：

- 同一业务订单映射出的 CanonicalOrder 核心字段一致。
- 重复事件不产生重复订单。
- 调度引擎、Redis Key、高德和前端 DTO 不因外部字段名改变而修改。
- 外部 API 故障时，已进入内部系统的订单和执行任务仍可操作。

## 11. Gate 3-3 实施状态

| 当前能力 | 状态 | 说明 |
|---|---|---|
| PostgreSQL + Prisma | 已实施 | V2 实体、索引和兼容迁移已落地；Gate 3-2 审查新增独立 `DispatchEventOutbox` 迁移 |
| OrderSourceAdapter | 已实施 | 外部版本幂等、取消矩阵、完整 before/after 审计和事务内事件入队 |
| Redis 最新定位与锁 | 已实施 | 位置 CAS/TTL、批量读取、司机/订单短锁；故障时保守降级到数据库一致性保护 |
| 高德 ETA | 已实施 | 司机当前位置、既有时间轴 cursor 和计划池全部订单 deliveryLocation 必算，预计算全部必要 delivery→pickup 组合；未来优化不得用固定 Top-N 裁掉本轮动态 cursor |
| Assignment | 已实施 | Gate 3 提交器在事务中完成释放/新建、快照回写、预警、日志和聚合版本递增；相同逻辑计划重试保留原 Assignment |
| OperationLog | 已实施 | 自动调度、订单修改/取消、Assignment 回收、班次起止均保存操作者、原因、traceId 与必要前后值 |
| Vehicle | 已隔离 | 仅作展示快照，不进入调度输入、过滤或评分 |

### 11.1 依赖安全返修的数据边界

- Next.js 15.5.21、React 19.2.8 与 SheetJS 0.20.3 的适配没有修改 `prisma/schema.prisma`。
- migration 目录仍精确为 9 个，目录名、正向 SQL 与已有 rollback 文件内容均未在框架适配中变化。
- 数据表、字段、索引、约束、Prisma 枚举、持久化所有权和事务边界没有改变；不得把依赖升级误写成数据库版本升级。
- 最终 migration 清单和 SHA-256 只能从上述应用候选 Git 对象读取；不得对主工作区未提交文件计算后冒充候选指纹。

## 12. 实施顺序

与总体 Gate 架构对齐（详见《PRD V2 并行开发与分阶段验收设计》）：

```text
Gate 0：V2 文档冻结（含 CanonicalOrder 与 API 契约的文档级冻结）
→ Gate 1：data-model-v2 迁移设计与回滚 SQL
→ Gate 2：已冻结契约落成 TypeScript DTO、错误类型和契约测试
→ 并行线 1A OrderSourceAdapter V2
→ 并行线 1B 实时位置与班次
→ 并行线 1C A/B/C 调度核心
→ Gate 3 调度事务集成
→ Web 调度台 / 司机执行接口 / 预警与观测
→ 迁移验证、端到端验证与稳定化
```

不得在 schema 冻结前直接把 V2 状态塞进现有页面或 API。

## 13. 版本记录

| 版本 | 日期 | 内容 |
|---|---|---|
| V2.0 | 2026-07-13 | 冻结边界、CanonicalOrder、最小数据模型、重排一致性与迁移流程 |
| V2.0-r1 | 2026-07-17 | Gate 0 审查修订：`receivedAt` 定为服务端生成必填；`businessType` 锁定 V1 枚举值；新增 §7.1 位置口径与 §7.2 ETA 口径；`DispatchAlert` 状态定为 `OPEN/RESOLVED`；§12 与总体 Gate 架构对齐 |
| V2.0-r2 | 2026-07-17 | Gate 0 二轮返修：`planVersion` 归属司机计划聚合（§5.1/§6/§9）；§3.3 冻结 Order/Event 唯一键与旧版本晚到不覆盖规则；`sourceSystem` 枚举冻结；§5.2 实体定为必须实施；Redis Key 命名定性为非契约示例；§7.1 区分“接收即过期拒收”与“老化转 STALE” |
| V2.0-r3 | 2026-07-17 | Gate 0 三轮返修：§6 补版本携带命令两分类；§3.1/§5.1 冻结 `sourceStatusRaw` 仅持久化 `OrderSourceEvent`；§3.3 冻结 `sourceVersion` 两种合法格式（UTC `Z` 毫秒 ISO 或零填充序号） |
| V2.0-r4 | 2026-07-17 | Gate 0 四轮返修：§6 版本携带规则改封闭式（补模块修改/位置变化/订单接入/周期校验）；§3.3 冻结 `"v1-migration"` 保留值例外（仅 `V1_IMPORT`，不经在线 ingest，不参与比较） |
| V2.0-r5 | 2026-07-18 | Gate 1 冲突裁决：`orderNo` 明确为非唯一展示号；`"v1-migration"` 扩展为存量迁移及 V1 写兼容基线，保留原来源映射，版本比较时恒小于合法在线版本 |
| V2.0-r6 | 2026-07-26 | Gate 3-2 审查返修：冻结内部调度事件与外部 `OrderSourceEvent` 的所有权边界；新增事务型 `DispatchEventOutbox`、至少一次消费/退避重试/周期补偿语义；更新重排事务步骤与实施状态 |
| V2.0-r7 | 2026-07-26 | Gate 3-2 二次返修：区分 200m/120s 历史采样与 200m/ETA 缓存到期调度触发，冻结 `planVersion`/outbox 原子边界；司机当前位置和既有时间轴 cursor 为 ETA 必算起点 |
| V2.0-r8 | 2026-07-26 | Gate 3-2 追加 ETA P0 返修：计划池全部订单 deliveryLocation 纳入必算起点，恢复必要 delivery→pickup 组合；固定 Top-N 优化须待 cursor-aware 方案另行冻结 |
| V2.0-r9 | 2026-07-26 | G3-3：司机类事件按受影响门店加载全部活动司机；相同逻辑计划重试不产生 Assignment/版本抖动；outbox 完成确认校验当前租约所有权 |
| V2.0-r10 | 2026-08-01 | 对齐应用候选 `7f60fd0d55783d1f057c814e46a3dab7f73e2416`：确认框架与 Excel 安全返修未改变 Schema、Prisma 枚举或 9 个 migration 内容，并冻结从 Git 对象生成最终指纹的规则 |
| V2.0-r11 | 2026-08-01 | 对齐最终候选 `3dea9260865f7e6ed42938d83e370e3823d31a2d`：两份 rollback 仅修正外键拆除顺序，最终 Schema、Prisma 枚举和 9 个正向 migration 内容零变化；空库演练差异为 0 |
| V2.0-r12 | 2026-08-02 | 对齐部署可用性返修后的唯一候选 `169f2ad8b27f9f0be2d4630144315694656b6a67`：Schema/migration tree 与旧冻结候选完全相同，原空库演练和指纹继续有效 |
| V2.0-r13 | 2026-08-02 | 对齐部署入口加固候选 `7378303f513d92e781a7930cfff7e14269ec3126`：Schema blob 与 migration tree 继续完全相同，无数据架构变更 |
| V2.0-r14 | 2026-08-03 | 对齐 Compose 命令修正候选 `492c86ea51b40da9426b8ad5b6aef861aa429ab5`：Schema blob `196a87c7...`、migration tree `c9b46aa4...` 与 9 个 migration 原始字节继续完全相同，无数据架构变更 |

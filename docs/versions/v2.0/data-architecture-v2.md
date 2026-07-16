# 人车单数据架构说明 V2

> 架构版本：`RCD-DATA-V2.0-20260713`  
> 状态：架构口径冻结；物理 schema 与迁移脚本尚未实施  
> 目标：当前 RDS 可运行，未来替换外部 API 时迁移代价最小

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
| `sourceSystem` | string | HALUO/API/PLUGIN 等 | `channel/source` |
| `externalOrderId` | string | 来源内唯一 ID | Adapter 已有，Order 尚未持久化 |
| `orderNo` | string | 用户可见订单号 | `Order.orderNo` |
| `sourceVersion` | string | 外部版本或更新时间 | V2 新增 |
| `businessType` | enum | 门店取/还、送车、上门取车 | `Order.type` |
| `promisedPickupAt` | datetime | 承诺取车时间 | 当前 `scheduledAt` |
| `pickupAddress` | string | 取车地址原文 | 已有 |
| `deliveryAddress` | string | 送达地址原文 | 当前 `returnAddress`，V2 统一语义 |
| `storeCode` | string | 归属门店编码 | 当前通过 `storeId` 关联 |
| `sourceStatusRaw` | string | 外部原始状态 | V2 新增 |
| `receivedAt` | datetime | 系统接收时间 | 建议独立保存 |

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

### 3.3 幂等键

```text
(sourceSystem, externalOrderId, sourceVersion)
```

- 相同版本重复到达：返回已有处理结果。
- 新版本到达：更新订单快照，生成来源事件和变更日志。
- 订单号不能单独作为幂等键，避免不同来源重号。

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
| `Order` | 订单号、类型、地址、坐标、时间、快照 | 增来源 ID/版本、承诺时间语义、外部原始状态、可行性 |
| `Driver` | 人员、门店、状态、最近位置 | 增当班状态和位置有效性；S1-S4 后续兼容迁移 |
| `Assignment` | 订单与司机关系、历史链 | 增顺序、计划时间、锁定、执行事件和计划版本 |
| `OperationLog` | 操作人、动作、metadata | 扩展自动重排、模块修改、字段修改、预警处理 |
| `GeocodeCache` | 地址与坐标缓存 | 保留 |
| `Vehicle` | 车辆及订单快照关联 | 保留展示，从调度约束中移除 |

### 5.2 建议新增的最小实体

| 实体 | 用途 | 设计理由 |
|---|---|---|
| `OrderSourceEvent` | 来源、外部 ID、版本、接收结果、原始 JSON 摘要 | 幂等、追溯和 API 联调 |
| `DriverShift` | 上下班时间和当班状态 | 是否参与调度不能只靠位置判断 |
| `OrderServicePlan` | 五个模块选择、总时长、修改版本 | 用受控枚举 + JSONB，避免五张配置表 |
| `DispatchAlert` | 不可行预警、处理状态、解决方式 | 预警需持续展示，不能只写日志 |
| `DriverLocationSample` | 按策略采样的历史位置 | Redis 只存最新位置，不能事后追溯 |

为保持精简，V2 不建立“模块字典表”和“全天排程表”。A/B/C 由有效 Assignment 的计划顺序派生。

## 6. Assignment V2 关键字段

| 字段 | 用途 |
|---|---|
| `sequenceNo` | 司机当前计划顺序；前三个有效项派生 A/B/C |
| `planVersion` | 防止旧重排覆盖新重排 |
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

## 7. 实时数据与持久数据

| 数据 | Redis/Tair | PostgreSQL/RDS |
|---|---|---|
| 司机最新位置 | 主存，短 TTL | 按策略采样、最近位置兜底 |
| 在线状态 | 主存，短 TTL | 上下班记录和最后在线时间 |
| ETA | 30–120 秒缓存 | 只保存用于排程或审计的结果 |
| 调度短锁 | 5–15 秒 | 最终 Assignment 用事务提交 |
| A/B/C 结果 | 可缓存快照 | Assignment 是事实来源 |
| 操作和预警 | 可做通知缓存 | 必须持久化 |

建议 Key：

```text
driver:last_location:{driverId}
driver:online:{driverId}
eta:{originHash}:{destinationHash}:driving
dispatch:lock:{driverId}
order:lock:{orderId}
dispatch:snapshot:{driverId}:{planVersion}
```

## 8. 高德调用边界

- 地址首次进入或变更：地理编码。
- 调度预筛后：只对可能进入 A/B/C 的少量组合计算路径 ETA。
- 出发：用手机位置到当前工单取车点开启导航并刷新 ETA。
- 到达：记录实际时间；后续计划起点先按预计送达位置计算。
- 完成：用手机实时位置作为下一工单 ETA 起点。
- 高德失败：标记 ETA 不可用并进入人工判断，不允许填演示数字或假 ETA。

## 9. 重排一致性

1. 为受影响司机和订单取得 Redis 短锁。
2. 读取当前 `planVersion`、锁定和执行状态。
3. 计算候选 A/B/C 与 ETA。
4. 在数据库事务中验证版本未变化。
5. 写入顺序、计划时间、可行性、预警和日志。
6. 递增 `planVersion`，释放短锁。
7. 前端刷新受影响对象。

版本已变化时放弃旧计算并重新排，不允许最后写入者无条件覆盖。

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

## 11. 当前代码差距

| 当前能力 | 状态 | V2 差距 |
|---|---|---|
| PostgreSQL + Prisma | 已有 | 缺来源事件、班次、模块计划、预警等数据 |
| OrderDTO Adapter | 已有 | `externalOrderId` 未落库，缺版本和原始状态 |
| Redis 最新定位 | 已有 | 需明确采样与过期策略 |
| 高德 ETA | 已有 | 当前是单订单候选 ETA，需支持 A/B/C 衔接 ETA |
| Assignment | 已有 | 缺顺序、锁定、计划版本和出发/到达事件 |
| OperationLog | 已有 | Action 枚举不足以覆盖 V2 追溯 |
| Vehicle | 已有 | 需从匹配逻辑移除，数据继续展示 |

## 12. 实施顺序

```text
V2 文档冻结
→ CanonicalOrder/API 契约
→ data-model-v2 迁移设计与回滚 SQL
→ OrderSourceAdapter V2
→ 实时位置与班次
→ A/B/C 调度引擎
→ Web 调度台
→ 司机执行接口
→ 预警、日志与稳定性验证
```

不得在 schema 冻结前直接把 V2 状态塞进现有页面或 API。


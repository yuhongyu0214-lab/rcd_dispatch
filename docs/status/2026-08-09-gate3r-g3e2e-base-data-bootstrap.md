# Gate 3-R 状态：G3E2E R2.2 隔离基础资料写入与核验

> 文档类型：`STATUS / EVIDENCE`
> 状态：`PREPROD_G3E2E_R2_2_BASE_DATA_PASS`
> 日期：2026-08-09（Asia/Shanghai）
> 权威范围：仅记录预生产隔离基础资料的执行事实、安全边界和验收证据
> 非权威范围：不定义产品行为、Schema、HTTP 契约、枚举、调度规则或生产上线结论

## 1. 执行对象

| 项目 | 事实 |
|---|---|
| 应用候选 | `codex/v2-gate3-app-candidate @ 4eb3b4857caae9730eb70dd9f2fb152bd8972ca0` |
| 运行镜像 | `sha256:9ec8265b971453edd73bc4e0ea882c3d8665ed46beabf78756d03409e80c962f` |
| 目标库 | `rcd_v2_preprod` |
| 数据集 | `G3E2E-DATASET-R2-SHANGHAI` |
| 执行包 | `G3E2E-BOOTSTRAP-R2.2-SHANGHAI` |
| ZIP SHA-256 | `e19503c45d64364205f49953b7293540b1c885413fca9fed67fd320c6f9e40ea` |
| 业务数据指纹 | `654ef049d9b5a9a2c7f341246583af03b5d7a10987f18c2c7767ecb86d300b52` |

R2.1 因 `pg_advisory_xact_lock()` 返回 `void` 与 Prisma 反序列化不兼容，在事务第一条锁语句失败，写后标记计数为零。R2.2 只修复锁返回类型，业务数据指纹不变。R2.1 与 R2.2 都不得对当前预生产库再次执行。

## 2. 执行前证据

- ECS 静态预检通过：ZIP 指纹、包内指纹、固定数据指纹、镜像身份、Compose 解析和无运行中 migration 全部符合。
- R2.2 双身份只读预检通过：app 与 owner 均指向 `rcd_v2_preprod`，4 张基础表 owner 与 app 最小权限符合冻结口径，所有 G3E2E 标记计数为零。
- 双身份只读证据：`/home/rcdops/evidence/g3e2e-r2.2-dual-readonly-preflight-20260809T091544Z.log`。
- 预检后 owner 旧凭据明确被拒绝，临时连接文件已删除，运行容器未变化。

## 3. 一次性写入结果

owner 只在受控变更窗口内使用，连接文件为 `root:root 600`，不进入 `preprod.env`、Compose、Git、镜像、运行容器环境或日志。写入在 Serializable 单事务中完成，并取得数据集专用 advisory lock。

| 对象 | 数量 | 结果 |
|---|---:|---|
| Store | 3 | 内容完全匹配 |
| User | 6 | 1 名调度员 + 5 名司机，关联完整 |
| Driver | 5 | 内容完全匹配；`onShift` 触发器差异经受控修正 |
| Vehicle | 8 | 4 台燃油蓝牌 + 4 台新能源绿牌，内容完全匹配 |
| DriverShift | 0 | 未提前上班 |
| DriverLocationSample | 0 | 未注入位置 |
| Order | 0 | 未写入订单 |

一窗口证据：`/home/rcdops/evidence/g3e2e-r2.2-one-window-20260809T093657Z.log`。该证据中 `WRITE_PASS=true`，首次写后核验只因 5 名司机的 `onShift` 不符合冻结初始值而失败，其他对象已通过。

## 4. `onShift` 差异与受控修正

真实数据库中的 `Driver_sync_v2_compat_fields` 兼容触发器会在插入 `status=S1`
时将 `onShift` 派生为 `true`，因此 R2.2 包中同时写入 `status=S1` 与
`onShift=false` 的初始预期无法在插入语句上直接成立。这是执行包验收预期与已冻结
migration 兼容触发器的差异，不是 worker 或未授权外部请求改动。

经用户单独批准，使用既有 `rcd_v2_preprod_app` 权限对精确 5 名 G3E2E 司机做了一次
原子修正：只将 `onShift=true` 改为 `false`，不修改 `status=S1`、
`availability=AVAILABLE`、`planVersion=1` 或其他字段，不新建班次。修正标志为
`G3E2E_R2_2_ONSHIFT_CORRECTION_PASS UPDATED=5`。

修正后以 app 身份执行冻结的逐项核验，得到：

```text
G3E2E_R2_2_BASE_VERIFY_PASS
counts: stores=3, users=6, drivers=5, vehicles=8
business facts: shifts=0, locationSamples=0, orders=0
contentExactMatch=true
```

R2.2 在当前预生产环境的基础资料子闸门因此为 `PASS`，但这不允许将未修正的
R2.2 包对新环境直接复用，也不允许对当前环境重跑。如未来需要新建等价环境，必须先修复
bootstrap 包的插入/验收顺序并重新冻结指纹。

## 5. owner 关闭与秘密边界

- 写入后已再次重置 `rcd_v2_preprod_owner` 密码。
- 只有明确认证拒绝被计为旧凭据失效；DNS、网络或超时不能冒充通过。
- `OLD_OWNER_CREDENTIAL_REJECTED_PASS`、`OWNER_SECRET_DELETED_PASS`、`NO_RUNTIME_CHANGE_PASS` 均通过。
- 最终 owner 关闭证据：`/home/rcdops/evidence/g3e2e-r2.2-owner-retire-20260809T093813Z.log`。
- R2.2 临时密码副本已删除；真实密码未进入聊天、Git、镜像或运行日志。

## 6. 当前边界和下一步

已完成的只是隔离基础资料，尚未验收：

1. 调度员和司机真实登录；
2. 5 名司机通过现有 H5/API 上班与位置上报；
3. 10 个上海隔离订单的当前时间投递；
4. 真实高德 ETA、A/B/C 衔接、并发、不可行预警与手工改排；
5. Tair 锁竞争/降级、worker 故障、应用回退和 Gate 3 终审。

Gate 3 继续 `NOT_PASS`，第二轮并行继续 `FROZEN`。

## 7. 大白话

三家门店、一名调度员、五名司机和八台车已经安全放进预生产库，且用日常 app 账号逐项查过。
一次性管理员钥匙已换掉并删除临时副本。中间暴露的上班字段冲突已如实记录并做了最小修正，
没有重新导入整批数据。现在可以进入真实登录、上班、定位和订单调度验收，但还不能宣布 Gate 3 通过。

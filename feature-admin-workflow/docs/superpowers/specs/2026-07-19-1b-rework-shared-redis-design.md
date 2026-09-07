# 1B 返修设计：位置/班次并发正确性 + 共享 Redis 原子化（2026-07-19）

> 状态：待用户审阅
> 范围：审查结论 3 P0 + 3 P1 的全部返修；拆分为共享设施线（feature/v2-shared-redis）与 1B 消费线（feature/v2-realtime-location）
> 决策来源：2026-07-18 审查结论 + 用户两轮裁决（redis.ts 移交共享设施所有者；DB 高水位降级幂等；地图同源快照；提交与合入顺序；六条验收标准）

---

## 0. 背景与契约出处

| 审查问题 | 冻结契约出处 |
|---|---|
| P0-1 Redis 最新位置并发倒退 | 数据架构 V2 §7「司机最新位置：Redis 主存」；PRD「不得拿旧位置冒充实时位置」 |
| P0-2 位置幂等不满足跨批次契约 | API 契约 V2 §1.6「位置上报按 (driverId, capturedAt) 去重，重复样本静默忽略并计入 skipped」 |
| P0-3 上下班无短锁/事务/planVersion | API 契约 V2 §1.6「上下班……由服务端对受影响司机取短锁，在事务内读取、校验并递增 planVersion」；术语表「调度短锁 dispatch:lock:{driverId}，5–15 秒」；错误码 409 `DUPLICATE_OPERATION` |
| P1-1 下班 404 仍提交副作用 | 审查要求「先确认班次或在错误结果下回滚」 |
| P1-2 地图混合 Redis freshness + DB 坐标 | 数据架构 V2 §7「Redis 主存 / PostgreSQL 采样兜底」；用户裁决「坐标与 freshness 必须来自同一位置快照」 |
| P1-3 TTL 300s ≠ 冻结 180s | 数据架构 V2 §7.1「Redis 最新位置 TTL：180 秒」 |

仓库结构实况：git worktree 根为 `人车单生态-v2-*` 各目录，应用位于仓内 `feature-admin-workflow/` 子目录。`feature-admin-workflow/src/lib/redis.ts` 在 develop 上存在（v1 遗产，v2 各分支未改动），共享设施分支从 develop HEAD 修改它没有障碍。

---

## 1. 共享设施线：feature/v2-shared-redis

从**执行时的 develop HEAD** 创建分支，**单提交**：
`fix(v2-shared-redis): 原子化司机位置写入并统一实时键 TTL`
只修改 `feature-admin-workflow/src/lib/redis.ts` 及新增设施级测试 `feature-admin-workflow/src/lib/redis.test.ts`。

### 1.1 新增 `setDriverLocationIfNewer`

```ts
type SetLocationOutcome = "applied" | "duplicate" | "stale" | "unavailable";
setDriverLocationIfNewer(driverId: string, data: DriverLocation & { tsMs: number }): Promise<SetLocationOutcome>
```

- Lua 脚本原子完成「读 `ts_ms` → 比较 → HSET 全字段 + EXPIRE 180」，消除读判写竞态窗口：
  - key 不存在或 `incoming.tsMs > existing.ts_ms` → 写入 + EXPIRE 180 → 返回 `applied`
  - 相等 → 不写 → `duplicate`
  - 更小 → 不写 → `stale`
- hash 新增数值字段 `ts_ms`（服务端解析 capturedAt 所得毫秒值）专用于比较；`ts`（ISO 字符串）保留展示语义。旧 hash 无 `ts_ms` 时按 key 不存在处理（一次性覆盖，随 TTL 自然收敛）。
- EVALSHA 缓存 + EVAL 回退，沿用 `RELEASE_LOCK_SCRIPT` 现有模式。
- 降级（熔断/未配置/异常）→ 返回 `unavailable`，不抛错；调用方转 DB 重判。

### 1.2 新增 `getDriverLocationsWithStatus`

```ts
getDriverLocationsWithStatus(driverIds: string[]): Promise<{
  redisAvailable: boolean;                      // false = 整体不可用（降级或管道整体失败）
  locations: Map<string, DriverLocation | null>; // available 时 null = 该司机确实无键
}>
```

明确区分用户裁决的两种情况：「Redis 正常但某司机无位置」（`redisAvailable: true` + Map 值 null）与「Redis 整体不可用」（`redisAvailable: false`）。既有 `getDriverLocations` 保留并委托新函数，不破坏 v1 调用方。

### 1.3 统一实时键 TTL = 180s

- `driver:last_location:*`：Lua 内 EXPIRE 180；legacy `setDriverLocation` 的 EXPIRE 300 → 180。
- `driver:online:*`：EX 300 → 180（「统一实时键 TTL」；与位置同窗口，STALE 120s < TTL 180s 语义成立）。
- ETA / 地图快照 / 派单锁 TTL 不动。

### 1.4 设施级测试（redis.test.ts）

假客户端注入（mock ioredis），断言：
1. 交错写入：eval 返回 stale 时不覆盖（旧位置不能覆盖新位置）
2. 同时间戳并发：第二次返回 `duplicate`，仅一次 `applied`
3. 乱序样本返回 `stale`，缓存不倒退
4. 脚本 ARGV 中 TTL 精确为 180（含 legacy 路径与 online 键）
5. 降级 → `unavailable`；批量读三态区分（个体缺失 vs 整体不可用）
（真实 Redis 集成用例以 `REDIS_URL` 守卫，无则 skip。）

---

## 2. 1B 消费线：位置管线（P0-1 / P0-2）

`processLocationBatch` 每样本统一流水（**DB 高水位抢占是幂等权威；Redis CAS 是缓存单调层**——两层缺一不可：DB 串行化接受判定，但抢占成功后的 Redis 写仍可能交错，须由 CAS 兜住）：

1. **校验**（不变，含批内去重集合与已采样预查集合，命中 → skipped/DUPLICATE）
2. **DB 高水位抢占**：
   `driver.updateMany({ where: { id, OR: [{lastLocationCapturedAt: null}, {lastLocationCapturedAt: {lt: capturedAt}}] }, data: { lastLat, lastLng, lastAccuracyMeters, lastLocationCapturedAt } })`
   - count=1 → 本样本为已知最新，继续
   - count=0 → 重读 `lastLocationCapturedAt`：**相等 → skipped/DUPLICATE**（跨批次幂等命中）；**更大 → 乱序样本保守跳过，不允许倒退**（reason 复用 `DUPLICATE`，结构化日志 `dedup: "OUT_OF_ORDER"` 区分；见 §7 默认决策 1）
   - 抢占语句抛错（DB 故障）→ 向上抛，路由包壳返回整批 500 `INTERNAL_ERROR`（见 §7 默认决策 2）
3. **Redis CAS**（count=1 时）：`setDriverLocationIfNewer` → `applied` 正常；`stale`/`duplicate`（Redis 比 DB 新的罕见漂移）→ 仅 warn，判定仍以 DB 为准；**`unavailable` → 已由 DB 完成重判，样本继续**（即用户验收「Redis 故障进入 DB 重判」）。`setDriverOnline` 照旧。
4. **采样判定 + 历史写入**：规则 7 不变；**P2002 → 该样本改判 skipped/DUPLICATE**（不计入 dbSampleWriteFailures、不得返回 success）；其他持久化错误维持 best-effort success + 计数告警。
5. 删除现批前 Redis 预读与 `newestRedisCapturedAtMs` 簿记（由 CAS 取代）。

**幂等原理**：接受（success）当且仅当抢占成功，抢占成功必然推进高水位 `Driver.lastLocationCapturedAt`——高水位本身即持久幂等记录，跨批次重复样本（无论当初是否采样入库）恒 ≤ 高水位 → 恒 skipped。无需新增接收表。

---

## 3. 1B 消费线：班次并发（P0-3 / P1-1）

### 3.1 startShift

1. `acquireDispatchLock(driverId)`（键即 `dispatch:lock:{driverId}`，术语表口径；TTL 10s）失败 → **409 `DUPLICATE_OPERATION`**；`finally` 释放。
2. 事务内：
   - 条件抢占 `driver.updateMany({ where: { id, isActive: true, onShift: false }, data: { onShift: true, availability: "AVAILABLE", planVersion: { increment: 1 } } })`
   - count=1 → 同事务 `driverShift.create`（中途失败整体回滚，无半状态、无孤立班次）
   - count=0 → 事务内重读：司机不存在/inactive → 404；`onShift=true` → 幂等路径：返回既有开放班次（无开放班次行 → 事务内补建修复行，沿用现行为）；幂等重放**不**递增 planVersion（对齐 §1.6「重复设置无副作用」先例）
3. Redis 降级时锁放行（现行为），条件 updateMany 仍保证**至多一个开放班次**（并发上班的最终防线）。

### 3.2 endShift

事务内顺序调整（短锁包裹同 3.1）：
1. driver 检查（不存在 → 404；`onShift=false` → ILLEGAL_TRANSITION，均不产生写）
2. **activeShift 查找提前**：无开放班次 → 仅修复 `onShift=false` → 返回 404（**不释放任务、不动 planVersion**——审查 P1-1 的修复点）
3. EN_ROUTE / IN_SERVICE guard（锁 + 事务内复查，防下班与出发竞态）
4. 释放 PLANNED（逻辑不变）
5. 关闭班次 + `onShift=false` + **planVersion 无条件 increment 一次**（下班本身即计划相关变化；释放分支不再单独递增，避免双加）

### 3.3 planVersion 规则表

| 场景 | planVersion |
|---|---|
| 上班成功（真实状态变化） | +1 |
| 上班幂等重放 / 修复补建 | 不变 |
| 下班成功（含释放 0..n 个 PLANNED） | +1（恰一次） |
| 下班无班次仅修复 flag | 不变 |

依据：API 契约 §1.6 与数据架构 §6「上下班……在事务内递增受影响司机 planVersion」+ 审查「每次班次变化的 planVersion 递增」。

---

## 4. 1B 消费线：地图路由（P1-2）

- 一次 `getDriverLocationsWithStatus(ids)` + 一次 `driverShift.findMany({ driverId: { in: ids }, endedAt: null })`（消除现有每司机 freshness/shift 的 N+1）。
- 每司机快照选择（**同源硬规则，禁止混源**）：
  - `redisAvailable && loc != null` 且字段完整可解析 → 坐标、capturedAt、freshness 全部来自该 Redis 快照（`calculateFreshness(loc.ts)`）
  - 否则（个体缺失、字段残缺或整体不可用）→ 全部来自 DB 四字段；四字段不全 → 按冻结契约 §3.3 整体省略 `lastLocation` 且 freshness 按 `lastLocationCapturedAt`（无则 NONE）——保持 16f8751 的整体省略语义
- `getDriverLocationFreshness` 单司机函数保留（`isCandidateDriver` 只需 freshness，无混源问题）。

---

## 5. 测试矩阵（映射六条验收 + 审查七场景）

| 验收/场景 | 层 | 用例 |
|---|---|---|
| 交错写入旧不覆盖新 | infra | CAS stale 分支不写 |
| 同时间戳并发仅一次成功 | infra + 1B | CAS duplicate；DB 抢占 count=0 相等 → DUPLICATE |
| 乱序样本不倒退缓存 | infra + 1B | CAS stale；count=0 更大 → 保守跳过 |
| TTL 精确 180s | infra | 脚本/EXPIRE 参数断言（location + online + legacy） |
| Redis 故障进入 DB 重判 | 1B | `unavailable` 路径样本仍按 DB 判定 |
| 地图 Redis 主读、DB 整体回退 | 1B | 命中同源 / 个体缺失回退 / 整体不可用回退 / 无混源断言 |
| 非采样样本跨批次重复 | 1B | 第一批接受不采样 → 第二批同 capturedAt → DUPLICATE |
| P2002 并发重复 | 1B | create 抛 P2002 → skipped/DUPLICATE、非 success |
| 并发上班 | 1B | 锁冲突 → 409；count=0 → 幂等同一班次；至多一个开放班次 |
| 上班中途失败回滚 | 1B | shift.create 抛 → 事务回滚、无半状态 |
| 下班与出发竞态 | 1B | guard 在锁 + 事务内复查；无班次时 assignment 零调用 |
| DB 故障整批 500 | 1B | 抢占抛错 → 路由 INTERNAL_ERROR |

---

## 6. 提交与验证序列

1. 设计文档提交（本文件，1B 分支）
2. `feature/v2-shared-redis`（自 develop HEAD）：单提交 redis.ts + redis.test.ts，四点式提交说明
3. develop 合入该分支 → develop 检出处全量验证（pnpm test / lint / build）
4. 1B `git rebase --rebase-merges` 到新 develop（**不 cherry-pick**；1B 未改过 redis.ts，预期无冲突；rebase 前丢弃 `tsconfig.tsbuildinfo` 工件改动）
5. 1B 消费提交（location 管线 / shifts / map+路由，按范围拆分）+ 测试矩阵
6. 1B 全量验证 + 调用 `rcd-code-review-v2-1` 复审（补上审查指出的缺口）
7. 全程**不 push**；结束报告各分支状态（见 §7 默认决策 3）

---

## 7. 决策记录

**用户裁决（已定）**：redis.ts 移交共享设施线、DB 高水位降级幂等（含 count=0 重读语义、P2002→DUPLICATE、不新增接收表）、地图同源快照与三态批量读、提交合入顺序与六条验收。

**默认决策（可在本文件审阅时否决）**：
1. 乱序样本 reason 复用 `"DUPLICATE"`（枚举封闭且属 contracts 范围；日志字段区分）。若需精确语义，另行走 v2-contracts 修订新增 `OUT_OF_ORDER`。
2. DB 抢占抛错 → 整批 500 `INTERNAL_ERROR`（幂等使重传安全；假 success 会丢数据）。
3. 本次不 push 任何分支/develop，由用户发布。
4. `tsconfig.tsbuildinfo`：本次仅丢弃工作区改动使状态干净；根治（untrack + .gitignore）越 1B 与 infra 范围，建议另行 repo chore。

**接受的偏差（记录在案）**：
- 乱序但移动 >200m 的样本旧逻辑可入历史库，新逻辑保守跳过——用户裁决以单调幂等优先，不新增接收表；如未来需要保存乱序样本，走 schema 变更（data-model 线）。
- Redis 与 DB 高水位在 DB 故障窗口后可能短暂漂移（Redis 领先），CAS 返回 stale/duplicate 时仅告警、以 DB 为准，随后续样本自然收敛。

## 8. 退出条件

审查 3 P0 + 3 P1 全部闭环；六条验收 + 审查七场景测试全绿；develop（合入 infra 后）与 1B（rebase 后）`pnpm test / lint / build` 全通过；工作区干净；`rcd-code-review-v2-1` 复审通过。

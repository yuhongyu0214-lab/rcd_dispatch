# 2026-08-09 Gate 3-R 真实 E2E 首轮失败记录

> 文档类型：`REPORT / STATUS_EVIDENCE`
> 结论：`FAIL / STOPPED_AFTER_NORMAL_ABC`
> 权威边界：只记录本轮预生产执行事实、证据和停止决定；不定义产品、API、Schema 或调度规则
> 运行候选：`7595a649e166e78bc4936d16e84e478bbc659309`
> 运行镜像：`sha256:2734a7fe5d96744523f71ab73a3d5efc74643099501489ccf0845808dd6f5844`

## 1. 执行边界

- 使用两台真实 iOS Safari 设备串行覆盖司机 01、司机 02；不得记为五台真机覆盖。
- 五个冻结司机账号的登录、自动上班和链路可达已验证；真实 GPS 只认司机 01、司机 02。
- 原始 E2E 数据包保持只读，checksum 校验通过；不直接写业务数据库。
- 未执行 migration、未重复写入基础资料、未清理本轮失败样本。
- 冻结范围与失败判定见[并行开发主计划](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md)。

## 2. 独立 API ingest 凭证与 app 更新

- 既有通用 ingest 凭证继续绑定 `HALUO`；新增独立凭证只绑定 `API`，密钥值未读取、未输出。
- Compose 只新增 `INGEST_API_KEY_API` 的 app 环境绑定；变更前后 SHA-256 分别为
  `b07fb40156819ae38bd4e6ed4414219869e950393dd7e68ef78e2f8623d9cd1a` 与
  `8b677307d93e41901542170f894acc0a5b3cca72d35aaa47c04743b28ac84b3c`。
- 只重建 app：app 容器由 `e01f5b857909…` 变为 `5759cb5b9d8f…`；worker
  `f659457c1449…` 与 Nginx `315ae3e14a40…` 保持不变。
- 最终 app、worker 均为 healthy，HTTPS `/api/health` 返回 `200`。
- 使用空记录分别验证 `API` 与 `HALUO` 绑定均通过鉴权边界并进入 DTO 校验，数据库写入为 `0`。
- 配置备份：`/srv/rcd-dispatch/backups/api-ingest-20260809T140251Z`。

## 3. 真实位置和订单接入

- 正式首组开始前，司机 01 的上海真实位置年龄为 26 秒、精度为 7.5 米，满足不超过
  120 秒和不大于 100 米的冻结条件；司机 02 保持过期以排除非目标司机。
- 正式时点为 `2026-08-09T14:07:45.000Z`，三单路线均由真实高德结果生成，没有伪造坐标、
  ETA 或承诺时间。
- `POST /api/v2/ingest/orders` 接收首组三单：`accepted=3 / skipped=0 / failed=0`，traceId 为
  `319fb3a3-09ff-4880-a818-b115bbf8a8e3`。
- 三个 `ORDER_CREATED` outbox 事件均记录 `attempts=1 / processed=true / lastError=null`。

## 4. 失败结果

| 项目 | 结果 |
|---|---|
| 第 1 单 | 曾创建一个自动 Assignment，后因位置过期在基线重算中释放 |
| 第 2、3 单 | 未创建 Assignment，保持 `UNASSIGNED / UNKNOWN` |
| A/B/C | 未形成三单 A/B/C 顺序和时间轴证据 |
| 当前三单 | 全部为 `UNASSIGNED / UNKNOWN`，没有当前 Assignment 或 `OPEN` 预警 |
| 第 4～10 单 | 未投递、未写入、未执行 |

首组已经触发“目标、顺序或可行性与冻结预期不符”的失败判定，因此本轮立即停止。预警、
并发、手动改排、到达后拒绝和幂等场景不得继续执行，也不得用后续重算成功覆盖本次首轮失败。

## 5. 诊断边界

- ETA 矩阵应用层使用 `Promise.allSettled`，被拒绝的必要路段没有形成逐路段错误日志；解析不到
  ETA 时规划器返回 `ETA_UNAVAILABLE / UNKNOWN`。
- 调度编排仍可提交零变化计划，并把对应 outbox 事件标记为已处理；当前没有为这类结果安排
  立即重试。
- 单独五路并发高德探测为 5/5 成功，因此不能把本次失败确定为固定 QPS 限流；缺少逐路段
  `infocode`，外部失败的精确原因仍未知。
- `GET /api/v2/driver/map` 返回 `NONE`，而调度数据库快照能读取同一真实位置，是另一项读取路径
  不一致缺陷。

## 6. 证据封存

远端证据目录：

`/home/rcdops/evidence/g3e2e-r2-normal-20260809T140605Z`

关键文件 SHA-256：

```text
42b203749d6fafb2c1eb04cb82dcfe8f7db57de847bb88965d69926762e72462  01-normal-abc.json
43342b373eb82edc3c1f99f7dc17ca2b6b145a69ee7ffe656ddd5536ff847194  normal-failure-snapshot.json
4e9fada5e03ec5067f8626ec8ab98cd993dcb302297c15c2e9170ae2734c342a  amap-eta-evidence.json
e6858121f9859ad9497d50af2e67971e13623750625fe8e3fd23bd678f60d581  normal-failure-snapshot-2.json
edb6fc1f80f2ed9b46e127f7a4289925ca4e9f06c3fb5986e24e865585180a34  projected-pickups.json
ee92f0701ccece2f6721edb370e50f5f3740f0228cd9a9e3e99fea548eb2556a  run-metadata.json
```

## 7. H5 范围与返修状态

- Gate 3 当前最小返修已在 `08d84cfc6624dc1e29f24b75f715550718067fb1` 完成并通过组件及
  全量回归：四类 `businessType` 只显示业务相关的一个导航入口；H5 不渲染 `[G3E2E]`
  开头的展示项，底层事实与证据不变。
- Gate 3 通过后专项：H5 实时高德地图、获准的司机/订单标记、列表联动、位置新鲜度和整体
  排版重做；当前第二轮继续冻结。
- 产品口径见 [PRD V2 §9.2](../versions/v2.0/prd-v2.md)，实施与验收范围见
  [并行开发主计划](../superpowers/specs/2026-07-13-prd-v2-parallel-development-design.md)。

## 8. 恢复验收前置

1. [x] ETA 必要路段失败的结构化诊断，不输出 Key 或敏感位置。
2. [x] `ETA_UNAVAILABLE` 零变化结果的受控重试/补偿，保持幂等且禁止假 ETA。
3. [x] 司机地图读取路径与调度快照一致，并覆盖新鲜/过期位置反例。
4. [x] Gate 3 H5 最小显示返修及其组件回归。
5. [x] 新 SHA、镜像 digest 和本地全量回归证据，见
   [最小 E2E 返修候选](2026-08-09-gate3r-minimal-e2e-remediation-candidate.md)。

上述完成只解除“可进入分阶段预生产更新”的前置阻断，不覆盖本报告的首轮 `FAIL` 事实；
ECS 对齐新候选后仍须从冻结的 10 单流程重新验收。

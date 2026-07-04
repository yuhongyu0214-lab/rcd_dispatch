# docs/import-template.md
# 订单导入模板说明

---

## 1. 标记字段定义

导入后每条订单生成一条地图标记，标记字段规则如下：

| 字段 | 组成规则 | 示例 |
|------|----------|------|
| 标记名称 | 时间戳 + 订单所属门店 + 车型 + 车牌号码 | `1716000000_上海虹桥店_SUV_沪A12345` |
| 标记备注 | 订单渠道 + 送车司机姓名 | `哈啰_张伟` |
| 经纬度 | 由外部 API 接口直接返回，无需地址转坐标 | `{ lat: 31.2304, lng: 121.4737 }` |

> 时间戳格式：Unix 时间戳（秒），13 位。

---

## 2. 订单字段定义

| 字段名 | 类型 | 必填 | 来源 | 说明 |
|--------|------|------|------|------|
| `orderId` | string | 是 | API / 手动 | 平台唯一订单号，重复则拒绝导入 |
| `orderType` | enum | 是 | API / 手动 | `STORE_PICKUP` / `STORE_RETURN` / `DOOR_DELIVERY` / `DOOR_PICKUP` |
| `storeId` | string | 是 | API / 手动 | 归属门店 ID，须与系统门店表匹配 |
| `vehicleType` | string | 是 | API / 手动 | 车型，须与系统车型枚举匹配 |
| `licensePlate` | string | 是 | API / 手动 | 车牌号（预排），格式：省份缩写 + 字母数字 |
| `channel` | string | 是 | API / 手动 | 订单渠道，如"哈啰""自营"等 |
| `driverName` | string | 是 | API / 手动 | 送车司机姓名 |
| `pickupAddress` | string | 是 | API / 手动 | 取车点地址（文字） |
| `returnAddress` | string | 是 | API / 手动 | 还车点地址（文字） |
| `pickupLat` | float | 是 | API 返回 | 取车点纬度，API 直接返回 |
| `pickupLng` | float | 是 | API 返回 | 取车点经度，API 直接返回 |
| `returnLat` | float | 否 | API 返回 | 还车点纬度，可为空（待人工补全） |
| `returnLng` | float | 否 | API 返回 | 还车点经度，可为空（待人工补全） |
| `scheduledAt` | datetime | 是 | API / 手动 | 预约时间。导入标准格式：`YYYY-MM-DD HH:mm:ss`；页面展示 / 导出展示格式：`MM-DD-HH:mm` |
| `importBatchId` | string | 系统生成 | 系统 | 导入批次号，系统自动生成，用于日志追踪 |
| `status` | enum | 系统生成 | 系统 | 导入后初始状态固定为 `PENDING`（待分配） |
| `createdAt` | datetime | 系统生成 | 系统 | 入库时间，系统自动写入 |

---

## 3. 数据来源

| 来源 | 说明 | V1 状态 |
|------|------|---------|
| 哈啰 API / 三方 SaaS API | 系统调用外部接口自动拉取，经纬度由 API 直接返回 | 已确认可用 |
| 手动导入（Excel / CSV） | 调度员上传标准模板文件，地址需调用高德地理编码转坐标 | V1 优先实现 |

> V1 优先实现手动导入。API 自动导入通过 `integration-adapter` 适配层对接，两种来源最终写入相同的字段结构。

---

## 4. 导入流程

```text
外部数据（API / Excel）
        ↓
   字段完整性校验（必填项）
        ↓
   格式合规校验（类型 / 枚举 / 时间格式）
        ↓
   重复订单检查（orderId 去重）
        ↓
   经纬度处理
   ├─ API 来源：直接使用返回的经纬度
   └─ 手动导入：调用高德地理编码转坐标
        ↓
   批量入库（status = PENDING）
        ↓
   写入导入日志（importBatchId / 成功数 / 失败数）
        ↓
   返回导入结果页（逐行展示成功 / 失败明细）
```

> 说明：导入校验与入库统一以 `YYYY-MM-DD HH:mm:ss` 为准；页面展示或导出展示可将 `scheduledAt` 渲染为 `MM-DD-HH:mm`，该展示规则不影响导入校验。

---

## 5. 校验规则与异常处理

| 异常类型 | 触发条件 | 处理方式 |
|----------|----------|----------|
| 必填字段缺失 | `orderId` / `orderType` / `storeId` / `vehicleType` / `pickupAddress` / `scheduledAt` 任一为空 | 拒绝该条导入，记录错误日志，注明行号和缺失字段名 |
| 订单重复 | `orderId` 已存在于数据库 | 拒绝该条导入，提示"订单号已存在" |
| 时间格式错误 | `scheduledAt` 不符合导入标准格式 `YYYY-MM-DD HH:mm:ss` | 拒绝该条导入，提示正确格式示例 |
| 车型不匹配 | `vehicleType` 不在系统枚举范围内 | 标记异常，允许入库，状态设为 `PENDING`，需人工核实 |
| 门店不存在 | `storeId` 在门店表中查无此记录 | 拒绝该条导入，提示"门店 ID 不存在" |
| 地址解析失败 | 手动导入时高德地理编码接口返回无结果 | 标记异常（`pickupLat` / `pickupLng` 为 null），进入人工处理队列 |
| 经纬度缺失 | API 来源但未返回经纬度字段 | 标记异常，进入人工处理队列，不阻断其他条目导入 |
| API 调用失败 | 外部 API 接口超时或返回非 200 | 自动重试 3 次，仍失败则整批进入待处理队列，记录错误日志 |
| 数据格式错误 | 字段类型不符（如经纬度传入非数字） | 拒绝该条导入，记录日志，注明行号和字段名 |
| 部分成功 | 同一批次内部分条目校验失败 | 成功条目正常入库，失败条目单独列出，不回滚成功部分 |

> 展示格式说明：若导入值为 `2024-05-01 10:00:00`，则页面展示或导出展示可显示为 `05-01-10:00`。

---

## 6. 导入结果反馈格式

导入完成后，页面展示以下信息：

```text
导入批次号：{importBatchId}
导入时间：{createdAt}
总条数：{total}
成功：{successCount}
失败：{failCount}

失败明细：
行号  订单号       失败原因
3     HLO_20240501 必填字段缺失：vehicleType
7     HLO_20240502 订单号已存在
12    —            时间格式错误：scheduledAt 应为 YYYY-MM-DD HH:mm:ss
```

> 页面展示或导出展示时，`scheduledAt` 可统一按 `MM-DD-HH:mm` 渲染；错误提示、导入校验和模板填写说明仍以 `YYYY-MM-DD HH:mm:ss` 为准。

---

## 7. 手动导入模板示例（Excel 列顺序）

| orderId | orderType | storeId | vehicleType | licensePlate | channel | driverName | pickupAddress | returnAddress | scheduledAt |
|---------|-----------|---------|-------------|--------------|---------|------------|---------------|---------------|-------------|
| HLO_001 | DOOR_DELIVERY | STORE_SH_01 | SUV | 沪A12345 | 哈啰 | 张伟 | 上海市长宁区虹桥路100号 | 上海市徐汇区漕溪路88号 | 2024-05-01 10:00:00 |

> `pickupLat` / `pickupLng` 列不需要填写，系统自动调用高德地理编码接口根据 `pickupAddress` 生成。
> 展示示例：上述 `scheduledAt` 在页面或导出展示中可显示为 `05-01-10:00`。

---

## 8. 相关文档

- 订单状态机：`docs/order-lifecycle.md`
- 调度规则：`docs/dispatch-rules-v1.md`
- 领域术语：`docs/domain-glossary.md`

# 人车单生态 RDS 与浏览器插件字段对接优化方案

> 目标：浏览器插件采集真实订单 → 后端/RDS 标准化入库 → 人车单 Web 地图、派单、司机端稳定闭环。

## 一、最终目标

本次优化不是把订单号改成 `RC` 前缀，而是建立真实数据链路：

1. 浏览器插件只采集真实原始数据，不生成订单号，不调用高德服务端接口。
2. 后端统一校验、映射、地理编码、写库。
3. RDS 保存标准化后的订单、坐标、状态、来源。
4. Web 地图只消费标准化结果，不在前端猜坐标。

验收时，地图上展示的每个订单号都必须能追溯到 RDS 真实 `OrderNo`。

## 二、模块边界

### 1. 浏览器插件

职责：

- 采集真实订单号、订单状态、订单类型、取还地址、预约时间、车牌、车型、门店、城市/区县。
- 如果页面本身能拿到坐标，则一并传给后端。
- 保留外部原始字段，如 `orderStatusRaw`、`orderTypeRaw`。

不做：

- 不生成 `RC` 订单号。
- 不调用高德服务端 geocode。
- 不写数据库。
- 不决定系统派单状态。

### 2. 后端 / RDS 入库层

职责：

- 统一接收插件/RDS 数据。
- 校验必填字段。
- 将外部状态、外部订单类型映射为系统枚举。
- 使用城市、区县、地址调用高德 geocode。
- 写入 `pickupLat/pickupLng/returnLat/returnLng`。
- 记录 geocode 成功、失败、城市不匹配等状态。

### 3. 人车单 Web 端

职责：

- 地图看板读取标准化订单。
- 有坐标订单落图。
- 无坐标订单仍显示在列表，但标记“位置待采集”，不落错误点。
- ETA 只基于真实坐标计算。
- 派单推荐不能使用假 ETA。

## 三、推荐插件传输 DTO

```json
{
  "orderNo": "RC...",
  "source": "HALUO",
  "orderStatusRaw": "待取车",
  "orderTypeRaw": "送车上门",
  "province": "江西省",
  "city": "南昌市",
  "district": "青山湖区",
  "pickupAddress": "站前西路195号",
  "returnAddress": "南昌西站",
  "pickupLat": null,
  "pickupLng": null,
  "returnLat": null,
  "returnLng": null,
  "scheduledAt": "2026-07-06 10:00:00",
  "licensePlate": "赣A09NP6",
  "vehicleType": "宝来",
  "driverName": "康亚伟",
  "storeName": "南昌站点"
}
```

## 四、字段清单

| 字段 | 必填 | 用途 | 备注 |
|---|---:|---|---|
| `orderNo` | 是 | 真实订单号 | 必须来自 RDS/页面真实 `OrderNo` |
| `source` | 是 | 来源追踪 | `HALUO` / `RDS` / `BROWSER_PLUGIN` |
| `orderStatusRaw` | 是 | 状态映射 | 后端统一映射为系统状态 |
| `orderTypeRaw` | 是 | 类型映射 | 后端统一映射为系统订单类型 |
| `province` | 建议 | geocode 限定范围 | 如 `江西省` |
| `city` | 是 | geocode 城市限定 | 如 `南昌市` |
| `district` | 建议 | geocode 区县限定 | 如 `青山湖区` |
| `pickupAddress` | 是 | 取车/送车地址 | 原始文本 |
| `returnAddress` | 是 | 还车/取回地址 | 原始文本 |
| `pickupLat/pickupLng` | 可选 | 地图点位、ETA | 页面有坐标则传 |
| `returnLat/returnLng` | 可选 | 司机导航 | 页面有坐标则传 |
| `scheduledAt` | 是 | 排序、时间窗 | 标准化为 `YYYY-MM-DD HH:mm:ss` |
| `licensePlate` | 建议 | 车牌快照 | 没有可为空 |
| `vehicleType` | 建议 | 车型展示 | 没有可为空 |
| `driverName` | 可选 | 司机快照 | 真实派单以系统 Assignment 为准 |
| `storeName/storeCode` | 建议 | 门店匹配 | 优先传门店名称和编码 |

## 五、订单类型映射

| 外部文本 | 系统枚举 | 地图颜色 |
|---|---|---|
| 门店取车 / 到店取车 | `STORE_PICKUP` | 蓝色 |
| 送车上门 | `DOOR_DELIVERY` | 蓝色 |
| 门店还车 / 到店还车 | `STORE_RETURN` | 绿色 |
| 上门取车 / 商家上门取车 | `DOOR_PICKUP` | 绿色 |

## 六、订单状态映射

| 外部状态 | 系统状态 |
|---|---|
| 待取车 / 待送车 / 待派单 | `PENDING` |
| 已派单 | `ASSIGNED` |
| 司机已接单 | `ACCEPTED` |
| 服务中 / 进行中 | `IN_PROGRESS` |
| 已完成 | `COMPLETED` |
| 已取消 | `CANCELLED` |

## 七、地理编码策略

后端 geocode 优先级：

1. 插件传入 `pickupLat/pickupLng`，先校验坐标范围，通过后直接写库。
2. 没有坐标时，使用 `province + city + district + pickupAddress` 调高德 geocode。
3. `returnAddress` 同样处理。
4. 地址已包含城市时，避免重复拼接。
5. 高德返回城市与传入城市不一致时，不写坐标，标记 `GEOCODE_CITY_MISMATCH`。
6. geocode 失败时订单仍可入库，但坐标为空，地图显示“位置待采集”。

建议写入状态：

| 状态 | 含义 |
|---|---|
| `SUCCESS` | 坐标成功 |
| `FAILED` | geocode 失败 |
| `MISSING_CITY` | 缺城市，未调用 geocode |
| `CITY_MISMATCH` | 返回城市不匹配 |
| `FROM_SOURCE` | 插件/RDS 已提供坐标 |

## 八、Web 地图调整

当前地图列表为 0 的主要原因是订单缺 `pickupLat/pickupLng` 后被过滤掉。

建议改为：

- `orders` 返回所有可见状态订单。
- `orderPoints` 只包含有坐标订单。
- 左侧订单列表显示所有可见订单。
- 有坐标订单落图。
- 无坐标订单显示“位置待采集”，不落图。

可见订单状态：

```text
PENDING / RECOMMENDING / ASSIGNED / ACCEPTED / IN_PROGRESS
```

## 九、派单与 ETA 规则

- ETA 只在订单有 `pickupLat/pickupLng` 且司机有位置时计算。
- 无坐标订单推荐派单应返回“需补坐标”或 `MANUAL`，不能显示假 ETA。
- 高德失败时展示“无法计算 ETA + 原因”。
- 禁止出现演示 ETA，如 `18m / 27m / 42m`。

## 十、开发执行顺序

1. 定义统一 `OrderIngestDTO`。
2. 增加城市/区县受控字典。
3. 改造 `/api/ingest/browser-extension` 和 `/api/ingest/order`，共用标准化函数。
4. 改造 geocode：拼接行政区划、校验返回城市、写入 geocode 状态。
5. 改造地图数据：订单列表与地图点位分离。
6. 改造浏览器插件：补采 `city/district/orderStatusRaw/orderTypeRaw`。
7. 补测试：短地址、缺城市、城市不匹配、无坐标订单列表可见、有坐标订单落图。

## 十一、验收标准

- 所有用户可见订单号都来自真实 `OrderNo`，不可杜撰。
- RC 订单缺坐标时也能出现在订单列表。
- 有坐标订单能正确落图。
- 缺坐标订单不落图，并显示“位置待采集”。
- “站前西路195号”等短地址 geocode 时必须带城市/区县。
- 高德返回城市不一致时不写坐标。
- 地图订单 marker 按订单类型着色。
- ETA 无假数据。
- 插件不暴露高德服务端 Key。
- `pnpm build` 和 `pnpm test` 通过。

## 十二、待确认项

请确认以下口径后再交给开发 agent：

1. 首批城市是否只支持 `南昌市`。
2. 是否要求 `district` 必填。
3. RDS `OrderNo` 的真实字段名是否固定为 `public.Order.OrderNo`。
4. 外部订单状态有哪些原始文本。
5. 外部订单类型有哪些原始文本。
6. 地图列表是否接受“无坐标订单可见但不落图”。

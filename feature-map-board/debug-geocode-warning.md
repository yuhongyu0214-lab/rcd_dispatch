# Debug Session: geocode-warning [RESOLVED]

## Symptom
- 订单导入主链路成功，但 `pickupAddress` 地理编码失败。
- 结果页显示 `success=1, failure=0, warning=1`。
- `Order.pickupLat` / `pickupLng` 为空。

## Current Evidence
- 订单已入库，`status = PENDING`
- `vehicleId` 已回填
- `OperationLog` 已记录 `IMPORT_BATCH`
- warning code 为 `GEOCODE_FAILED`
- 直接请求高德地理编码接口返回：
  - `{"status":"0","info":"INVALID_USER_KEY","infocode":"10001"}`
- 更换有效的 `AMAP_SERVER_KEY` 后，重新导入得到：
  - `success = 1`
  - `failure = 0`
  - `warning = 0`
- 5 条合法样本批次 `IMP_qu8ofj40rs7r` 已验证：
  - 全部 `PENDING`
  - `pickupLat/pickupLng` 全部非空
  - `OperationLog` 批次日志完整

## Falsifiable Hypotheses
1. 当前 `pickupAddress` 文本不够标准，高德接口返回空结果。 -> 未证实，非首因
2. `AMAP_SERVER_KEY` 未配置、无效或权限不足，导致高德接口返回失败。 -> 已证实
3. 当前 geocode 请求参数或响应解析逻辑存在问题，导致命中结果被误判为失败。 -> 已排除
4. 网络/超时导致请求被中断，进入统一的 `GEOCODE_FAILED` 分支。 -> 已排除

## Root Cause
- `.env.local` 中配置的高德 Web 服务 Key 无效，导致地理编码接口始终返回 `INVALID_USER_KEY`。
- 导入代码在收到失败响应后按既定容错策略将条目标记为 `GEOCODE_FAILED` warning，并继续入库。

## Resolution
- 更换为有效的高德 Web 服务 Key。
- 重启本地开发服务，使新的 `.env.local` 生效。
- 重新使用结构化地址导入验证，坐标成功写入数据库。

## Final Outcome
- 订单导入主链路通过验收。
- 5 条合法数据：全部入库，`status = PENDING`
- 1 条缺失必填字段：页面显示具体行号和字段名
- `OperationLog` 包含批次号、成功数、失败数、warning 数
- `pickupLat/pickupLng` 非空

## Follow-up
- 由于调试过程中曾在对话中暴露过一次高德 Key，建议在高德后台轮换该 Key。

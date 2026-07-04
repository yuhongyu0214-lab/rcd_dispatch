# 高德真实 API 接入前置检查报告

检查时间：2026-06-29

## 1. 结论

当前服务端高德 Web 服务已经具备接入条件：

- `AMAP_SERVER_KEY` 已配置。
- 地理编码接口真实调用成功。
- 驾车路径规划接口真实调用成功。
- 项目内 `/api/dispatch/recommend` 已经可以通过 `runDispatch()` 获取真实 ETA。

前端高德 JS 地图已完成真实接入所需的配置改造：

- `NEXT_PUBLIC_AMAP_JS_KEY` 已配置。
- `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` 已配置。
- 地图加载逻辑已在加载高德 JS API 前注入 securityJsCode。

## 2. 已检查变量

| 变量 | 当前状态 | 用途 |
|---|---|---|
| `AMAP_SERVER_KEY` | 已配置 | 服务端地理编码、服务端驾车路径规划、ETA |
| `NEXT_PUBLIC_AMAP_JS_KEY` | 已配置 | 前端高德 JS API 2.0 地图渲染 |
| `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 已配置 | 前端高德 JS API 安全密钥 |

说明：检查过程只验证变量是否存在和长度，不输出真实 key。

## 3. 真实 API 探测结果

### 地理编码

- 接口：`https://restapi.amap.com/v3/geocode/geo`
- 测试地址：上海虹桥门店取车区
- HTTP：200
- 高德状态：`status = 1`
- infocode：`10000`
- 结果：返回坐标

### 驾车路径规划

- 接口：`https://restapi.amap.com/v3/direction/driving`
- 测试起点：`121.3275,31.1977`
- 测试终点：`121.5991,31.2104`
- HTTP：200
- 高德状态：`status = 1`
- infocode：`10000`
- 结果：返回 duration，测试值约 2828 秒

### 项目内推荐接口

- 接口：`POST /api/dispatch/recommend`
- 结果：200
- outcome：`DISPATCHED`
- Top N：2
- 首位候选：李娜
- 首位 ETA：1 分钟
- 操作后已执行 `pnpm demo:reset:apply` 恢复演示数据。

## 4. 当前代码接入点

| 文件 | 当前作用 |
|---|---|
| `src/lib/dispatch/eta.ts` | 使用 `AMAP_SERVER_KEY` 调用驾车路径规划，失败降级为 `9999` |
| `src/lib/import/services/geocode.ts` | 使用 `AMAP_SERVER_KEY` 调用地理编码，失败按待补全继续导入 |
| `src/app/admin/map/page.tsx` | 将 `NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` 传入地图组件 |
| `src/app/admin/map/components/map-board.tsx` | 加载高德 JS API 2.0，并在加载前注入 securityJsCode |

## 5. 接入前必须补齐

1. 在高德控制台确认 JS API Key 已开通 Web 端。
2. 在 `.env.local` 填入 `NEXT_PUBLIC_AMAP_JS_KEY`。
3. 在 `.env.local` 填入 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。
4. 地图加载逻辑已注入：

```ts
window._AMapSecurityConfig = {
  securityJsCode: process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE
};
```

5. 前端真实地图接入后，用浏览器验证：
   - 地图脚本加载成功
   - `AMap` 对象可用
   - 点位 marker 正常渲染
   - 未配置或加载失败时仍回退到本地降级视图

## 6. 风险

| 风险 | 影响 | 建议 |
|---|---|---|
| JS Key 未配置 | 真实地图无法渲染 | 接入前补齐 |
| securityJsCode 未配置 | 高德 JS API 可能加载失败或受安全策略限制 | 与 JS Key 同步配置 |
| 服务端 Key 配额不足 | ETA 或地理编码降级 | 保留当前失败降级逻辑 |
| 推荐接口会改变订单状态 | 预检查污染演示数据 | 检查后执行 `pnpm demo:reset:apply` |

## 7. 下一步建议

前端真实高德地图接入已完成代码侧改造。下一步进入浏览器人工验收：

- 刷新 `/admin/map`。
- 确认地图提示为“高德地图已加载”。
- 确认点位 marker 正常渲染。
- 保留当前本地降级地图作为兜底。

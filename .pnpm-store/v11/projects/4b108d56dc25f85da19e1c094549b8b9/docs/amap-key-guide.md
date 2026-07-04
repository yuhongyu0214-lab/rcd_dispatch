# 高德 API Key 获取与配置指南

> 适用阶段：admin-workflow 及后续需要高德地图集成的所有阶段
> 最后更新：2026-06-30

---

## 1. 背景：项目需要哪几个 Key

本项目同时使用了高德的两套 API，分别需要不同的 Key：

| 环境变量 | 用途 | API 类型 | 调用位置 |
|---|---|---|---|
| `AMAP_SERVER_KEY` | 服务端：地理编码 + 驾车路径规划（ETA） | Web 服务 API | `src/lib/import/services/geocode.ts`、`src/lib/dispatch/eta.ts` |
| `NEXT_PUBLIC_AMAP_JS_KEY` | 前端：浏览器地图渲染（JS API 2.0） | Web 端 JS API | `src/app/admin/map/page.tsx` → `map-board.tsx` |
| `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 前端：JS API 安全密钥（2021.12.02 后申请的 Key 必须配置） | JS API 安全机制 | `src/app/admin/map/components/map-board.tsx` |

**一个高德账号、一个应用下可以同时创建多个 Key**，分别选择不同的服务平台即可。

---

## 2. 前置条件：注册高德开放平台账号

1. 打开 [高德开放平台](https://lbs.amap.com/)
2. 点击右上角 **"注册"**（或直接访问 [https://lbs.amap.com/dev/id/](https://lbs.amap.com/dev/id/)）
3. 按提示完成注册（支持手机号/邮箱注册）
4. **完成实名认证**——高德要求开发者完成实名认证后才能创建 Key（个人或企业均可）

---

## 3. 获取 Web 服务 API Key（`AMAP_SERVER_KEY`）

服务端 Key 用于地理编码（地址 → 经纬度）和驾车路径规划（ETA 计算）。

### 操作步骤

1. 登录 [高德开放平台控制台](https://console.amap.com/dev/key/app)
2. 进入 **应用管理** → 点击 **"创建新应用"**
   - 应用名称：如 `人车单调度系统`
   - 应用类型：选择 **"工具"** 或 **"出行"**（对功能无实质影响）
3. 在刚创建的应用下，点击 **"添加 Key"**
4. 填写 Key 信息：
   - **Key 名称**：如 `RCD-Server-Key`
   - **服务平台**：选择 **"Web服务"** ⚠️ 这是关键——选错平台会导致接口返回 `INVALID_USER_DOMAIN` 错误
   - **白名单**（如有）：留空即可（Web 服务 API 不受白名单限制）
5. 点击 **"提交"**
6. 复制生成的 Key 字符串

### 填入 `.env.local`

```bash
AMAP_SERVER_KEY=你复制的Key字符串
```

### 验证

替换 `<你的Key>` 后在浏览器或终端测试：

```bash
curl "https://restapi.amap.com/v3/geocode/geo?address=北京市朝阳区阜通东大街6号&key=<你的Key>"
```

预期返回 `status=1` 且含 `geocodes` 数组。

---

## 4. 获取 JS API Key + 安全密钥（`NEXT_PUBLIC_AMAP_JS_KEY` + `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`）

前端 JS API 2.0 需要 **同时配置 Key 和安全密钥**（2021 年 12 月 02 日后申请的 Key 强制要求）。

### 4.1 创建 JS API Key

1. 在同一个应用下（或新建应用），再次点击 **"添加 Key"**
2. 填写 Key 信息：
   - **Key 名称**：如 `RCD-JSAPI-Key`
   - **服务平台**：选择 **"Web端(JS API)"** ⚠️ 必须选这个，不是"Web服务"
   - **白名单**（如有）：留空或填 `localhost`（开发阶段）
3. 点击 **"提交"**
4. 创建成功后，你会看到两个值：
   - **Key** → 这就是 `NEXT_PUBLIC_AMAP_JS_KEY`
   - **安全密钥**（也叫 `securityJsCode`）→ 这就是 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`

> **注意**：安全密钥只在创建成功时显示一次，请务必立即复制保存。如果丢失，需要在控制台"应用管理"中重新生成。

### 4.2 填入 `.env.local`

```bash
NEXT_PUBLIC_AMAP_JS_KEY=你复制的JS API Key
NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=你复制的安全密钥
```

### 4.3 前端代码配置

安全密钥必须在地图 JS SDK 加载之前配置。项目的 `map-board.tsx` 中需要加入：

```ts
// 必须在 AMap JS SDK <script> 加载之前设置
window._AMapSecurityConfig = {
  securityJsCode: process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE,
};
```

> 参考官方文档：[JS API 安全密钥使用](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)

---

## 5. 最终 `.env.local` 示例

```bash
# 数据库
DATABASE_URL="postgresql://postgres:a19950218@localhost:5432/dispatch_system"
SHADOW_DATABASE_URL="postgresql://postgres:a19950218@localhost:5432/dispatch_system_shadow"

# NextAuth
NEXTAUTH_SECRET="your-generated-secret"

# 高德 - 服务端（Web 服务 API）
AMAP_SERVER_KEY=5a96219dxxxxxxxxxxxxxxxxxxxxxxxx

# 高德 - 前端（JS API 2.0）
NEXT_PUBLIC_AMAP_JS_KEY=af2fd4xxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=d4e5f6xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 6. 常见问题

### Q1：服务端 Key 和 JS API Key 能共用吗？

**不能。** 两个 Key 的"服务平台"不同，权限也不同。Web 服务的 Key 无法加载 JS API 地图，JS API 的 Key 也无法调用地理编码接口。必须分别申请。

### Q2：不配安全密钥会怎样？

JS API 2.0 初始化时会报错 `Invalid scode`，地图无法加载。安全密钥是强制要求（除非你的 Key 是 2021 年 12 月之前创建的）。

### Q3：安全密钥丢了怎么办？

登录 [高德控制台](https://console.amap.com/dev/key/app) → 应用管理 → 找到对应 Key → 点击"安全密钥"旁的 **"重新生成"**。

### Q4：前端 Key 暴露在浏览器端安全吗？

高德的安全机制主要依赖两点：
- **安全密钥**（`securityJsCode`）——对请求参数签名，即使 Key 暴露，缺少正确签名也无法调用
- **白名单/域名限制**——生产环境可以在高德控制台配置 Key 的白名单域名，只有指定域名才能使用

开发阶段可以直接在 `.env.local` 中明文配置。生产环境建议使用**代理服务器方式**（Nginx 反向代理），将安全密钥放在服务端，不在前端暴露。

### Q5：调用量配额不够用怎么办？

- Web 服务 API 免费版日调用量有限制（地理编码和路径规划各自有限额）
- JS API 2.0 免费版也有日 PV 限制
- 可在 [高德控制台](https://console.amap.com/dev/key/app) 查看配额使用情况
- 超出后可申请提额或购买商用授权

---

## 7. 操作检查清单

- [ ] 注册高德开放平台账号并完成实名认证
- [ ] 创建应用
- [ ] 在应用中创建 **"Web服务"** 类型的 Key → 填入 `AMAP_SERVER_KEY`
- [ ] 在应用中创建 **"Web端(JS API)"** 类型的 Key → 填入 `NEXT_PUBLIC_AMAP_JS_KEY`
- [ ] 复制安全密钥 → 填入 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`
- [ ] 重启开发服务器（`pnpm dev`），确认 Next.js 加载了新环境变量
- [ ] 验证服务端 Key：`curl` 测试地理编码接口
- [ ] 验证前端 Key：浏览器打开地图页面，确认地图正常渲染、无 `Invalid scode` 报错

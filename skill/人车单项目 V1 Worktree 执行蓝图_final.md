# 人车单项目 V1 Worktree 执行蓝图\_final

\> **版本**：Final（对齐版）

\> **更新说明**：

> - `dispatch-rule-v1` 从"可延后"升级为 V1 必做
> 
> - 合并路径统一为 `feature/* → develop → main`，补全全局规则
> 
> - 所有 Claude Code 指令模板补充"验收标准"字段
> 
> - 文档名称规范化（见第 0 节）
> 
> - `import-template.md` 标注补完要求
> 
> 



---



## **0\. 文档名称规范**



进入 `feature/docs-prd` 前，先完成以下两项重命名，后续所有指令模板均引用规范名称：



|原文件名|规范路径|状态|
|---|---|---|
|`gpt_dispatch_rules_v1_2.md`|`docs/dispatch-rules-v1.md`|已整理，可直接入库|

\| \`1776578059169\_saas订单信息导入\.md\` \| \`docs/import\-template\.md\` \| **第 4 条为空，须补完后才能冻结** \|



> `docs/dispatch-rules-v1.md` 的版本迭代在文件内部 changelog 标注，不通过文件名区分版本。
> 
> 



---



## **1\. V1 总览**



\- **V1 目标**：跑通一个可演示的人车单闭环，链路为 \`订单导入 → 地图看板 → 调度后台 → 推荐派单 → 演示收尾\`

\- **主线分支**：\`main\`（永远可演示）

\- **集成主干**：\`develop\`（feature 合并目标，联调稳定后再合 main）

\- **活跃 worktree 上限**：同时最多 4 个，避免上下文混乱



### **V1 必做 worktree（按顺序）**



1. `docs-prd`

2. `repo-bootstrap`

3. `data-model`

4. `order-import`

5. `map-board`

6. `admin-workflow`

7. `dispatch-rule-v1` ← 从"可延后"升级为必做，规则文档已完整，代码结构已设计

8. `logging-observe`

9. `integration-adapter`

10. `stabilization`

### **V1 暂缓完整落地**



- `driver-workflow`：先留状态流转和 API 契约，不做完整小程序端

---



## **2\. 执行顺序**

文档名称改为feature\-\*，以便于名称与开发环境保持一致性

```Plain Text
~~1.  feature/docs-prd~~
~~2.  feature/repo-bootstrap~~
~~3.  feature/data-model~~
~~4.  feature/order-import~~
~~5.  feature/map-board~~
~~6.  feature/admin-workflow~~
~~7.  feature/dispatch-rule-v1~~
~~8.  feature/logging-observe~~
~~9.  feature/integration-adapter~~
~~10. feature/driver-workflow（API 契约层）~~
~~11. feature/stabilization~~
```



---



## **3\. 全局规则**



### **3\.1 分支与合并**



\- **合并路径**：\`feature/\* → develop → main\`

- `develop` 是日常集成主干，始终保持可联调状态

- `main` 只接受来自 `develop` 的合并，永远可演示

- 每个 feature 退出条件满足并完成本地验收后，先合 `develop`

- `develop` 联调稳定后，统一合 `main`

- `release/mvp-demo` 从 `main` 拉取，用于演示封板

### **3\.2 开发纪律**



\- **一个 worktree = 一个明确产出**

\- **一个 Claude Code 会话 = 一个问题域**

\- **先文档，后 schema，再接口，最后页面**

\- **每个 feature 合并前至少完成一次本地验收**



### **3\.3 提交说明格式**



每次提交必须写清以下四项：



```Plain Text
做了什么：
没做什么：
依赖什么：
风险点：
```



### **3\.4 工具分工**



|工具|职责|
|---|---|
|`worktree`|隔离单元，每个分支独立工作目录|
|`Warp`（主终端）|CLI 操作：分支切换、迁移执行、服务启动|
|`Claude Code`|当前分支的实施助手，每次只处理一个问题域|
|`Trae / VS Code`|观察和 review 单元，diff 审核、上下文整理|
|`GPT`|文档整理、规则设计、测试用例、接口说明|
|`Gemini`|UI 布局建议、页面结构、交互细节|



---



## **4\. Worktree 执行蓝图**



---



### **4\.1 docs\-prd**



\- **worktree**：\`feature/docs\-prd\`

\- **目标**：冻结 V1 业务口径，让后续 schema 和接口不反复推翻

\- **输入**：现有思维导图、业务场景说明、订单 / 司机 / 车辆基础认知

\- **输出文件**：



|文件|说明|状态|
|---|---|---|
|`docs/prd.md`<br>|产品需求文档：目标、范围、角色、核心流程、验收标准|待写|
|`docs/domain-glossary.md`|领域术语表：统一"订单""派单""司机""状态"等名词定义|待写|
|`docs/order-lifecycle.md`|订单生命周期：各阶段状态流转和触发条件|待写|

\| \`docs/dispatch\-rules\-v1\.md\` \| 调度规则 V1（已整理完成，直接入库） \| **就绪** \|

\| \`docs/import\-template\.md\` \| 导入模板：字段、格式、示例、校验规则（第 4 条须补完） \| **待补完** \|



\- **进入条件**：项目正式启动，立即开始

\- **退出条件**：以上 5 份文档全部冻结，订单状态机、调度动作、导入字段、核心术语无歧义

\- **禁止修改**：不在此分支写任何业务实现代码



**Claude Code 指令模板**



```Plain Text
任务目标：整理并冻结 V1 全部业务文档
范围：只允许新建和修改 docs/ 目录下的 .md 文件
不要修改：任何 .ts、.tsx、.prisma 文件及目录结构
输入：现有思维导图、dispatch-rules-v1.md（已就绪）、import-template.md（需补完第 4 条）
输出：docs/ 下 5 份文档全部完成，内容无空项
验收标准：
  1. docs/import-template.md 第 4 条（校验规则 / 异常处理）已填写，无空行
  2. docs/order-lifecycle.md 包含完整状态机：待导入→待分配→推荐中→已派单→已接单→执行中→已完成→已回收→已取消
  3. docs/domain-glossary.md 包含：订单、司机、车辆、派单、改派、撤回、回收、门店、ETA、调度锁 的定义
  4. 所有文档无"待确认"空项（dispatch-rules-v1.md 第十一节的遗留项除外，已单独标注）
```



---



### **4\.2 repo\-bootstrap**



\- **worktree**：\`feature/repo\-bootstrap\`

\- **目标**：搭好可持续开发的工程地基

\- **输入**：\`docs/domain\-glossary\.md\`（术语）、\`docs/prd\.md\`（模块边界）

\- **输出**：



|产出|说明|
|---|---|
|Next\.js \+ TypeScript|基础框架|
|Tailwind CSS \+ shadcn/ui|UI 基础|
|ESLint \+ Prettier|代码规范|
|Prisma|ORM 初始化，暂不建表|
|Auth\.js|鉴权基础，支持调度员登录|
|`.env.example`|包含 `AMAP_SERVER_KEY`、`DATABASE_URL`、`NEXTAUTH_SECRET` 等|
|`src/` 目录结构|`app/`、`lib/`、`components/`、`types/`、`prisma/`|
|统一 API 响应格式|`{ success, data, error, traceId }`|
|基础日志封装|Pino 初始化，输出到 stdout（Railway 可直接采集）|



\- **进入条件**：\`docs\-prd\` 核心术语和模块边界已冻结

\- **退出条件**：项目可启动、可登录、可连库、目录清晰、基础规范稳定

\- **禁止修改**：不在此分支写订单导入、地图、调度流程的任何业务代码



**Claude Code 指令模板**



```Plain Text
任务目标：完成 Next.js 工程初始化，搭建可持续开发的工程地基
范围：根目录配置文件、src/ 目录骨架、lib/logger.ts、lib/api-response.ts、prisma/schema.prisma（空模型占位）、.env.example
不要修改：docs/ 文档、任何业务页面
输入：docs/domain-glossary.md（模块命名参考）
输出：工程可启动，Auth.js 登录页可访问，Prisma 可连接数据库
验收标准：
  1. pnpm dev 无报错，localhost:3000 可访问
  2. /api/auth/signin 登录页正常显示
  3. npx prisma studio 可连接数据库（表为空是正常的）
  4. .env.example 包含 DATABASE_URL、NEXTAUTH_SECRET、AMAP_SERVER_KEY 三个必填项
  5. src/lib/api-response.ts 导出统一响应格式，包含 traceId 字段
```



---



### **4\.3 data\-model**



\- **worktree**：\`feature/data\-model\`

\- **目标**：定义人车单 V1 的核心实体和关系

\- **输入**：\`docs/order\-lifecycle\.md\`（状态机）、\`docs/domain\-glossary\.md\`（术语）、\`repo\-bootstrap\` 的 Prisma 环境

\- **输出**：



|产出|说明|
|---|---|
|`prisma/schema.prisma`|六张核心表 \+ 枚举定义|
|`prisma/migrations/`|初始迁移文件|
|`prisma/seed.ts`|种子数据：3 条订单、2 名司机、1 个门店|



**核心表**：\`orders\`、\`drivers\`、\`vehicles\`、\`assignments\`、\`driver\_locations\`、\`operation\_logs\`



> `vehicles` 表须包含 `gpsLat Float?`、`gpsLng Float?` 预留字段（可为 null）。
> 
> 



\- **进入条件**：\`repo\-bootstrap\` 已能正常连接数据库

\- **退出条件**：迁移成功，seed 可跑，六张表关系明确

\- **禁止修改**：不改全局 UI、不重做项目目录结构



**Claude Code 指令模板**



```Plain Text
任务目标：定义人车单 V1 核心数据模型
范围：只允许修改 prisma/schema.prisma、prisma/seed.ts、prisma/migrations/
不要修改：页面文件、API 路由、lib/ 下业务逻辑、src/ 目录结构
输入：docs/order-lifecycle.md（订单状态枚举）、docs/domain-glossary.md（术语定义）
输出：六张表完整建模，含状态字段、时间戳、操作留痕字段、vehicles 表 GPS 预留字段
验收标准：
  1. npx prisma migrate dev 执行无报错
  2. npx prisma db seed 成功写入至少 3 条订单、2 名司机、1 个门店
  3. npx prisma studio 可查看所有表结构和关系
  4. vehicles 表包含 gpsLat / gpsLng 字段（nullable）
  5. orders 表的 status 枚举覆盖 order-lifecycle.md 中所有状态值
```



---



### **4\.4 order\-import**



\- **worktree**：\`feature/order\-import\`

\- **目标**：把外部订单模板导入系统，完成校验与入库

\- **输入**：\`docs/import\-template\.md\`（已冻结）、\`data\-model\` 的 orders 表结构、高德地理编码 API

\- **输出**：



|产出|说明|
|---|---|
|上传页面|`app/admin/import/page.tsx`|
|模板校验|必填字段、格式、枚举值校验，Zod schema|
|错误提示|逐行报错，说明哪行哪列有问题|
|地址转坐标|调用高德地理编码 API，取车点 \+ 还车点各转一次|
|批量入库|Prisma `createMany`，支持部分成功|
|导入日志|写入 `operation_logs`，记录批次号、成功数、失败数|



\- **进入条件**：\`docs/import\-template\.md\` 已冻结，\`data\-model\` 退出条件满足

\- **退出条件**：合法 Excel 可成功入库；非法数据给出可理解的逐行报错

\- **禁止修改**：不重构 schema 主体，不改地图看板结构



**Claude Code 指令模板**



```Markdown
任务目标：实现订单 Excel 导入链路
范围：app/admin/import/、lib/import/、app/api/import/
不要修改：地图相关页面、调度相关 API、prisma/schema.prisma 主体结构
输入：docs/import-template.md（字段定义和校验规则）、prisma/schema.prisma（orders 表结构）
输出：上传页面可用，校验报错可读，成功入库后跳转导入结果页
验收标准：
  1. 上传一份包含 5 条合法数据的 Excel，全部入库，status 为 PENDING
  2. 上传包含 1 条缺失必填字段的数据，页面显示具体行号和字段名报错
  3. 入库后 operation_logs 表有对应导入记录，包含批次号和成功/失败计数
  4. 取车点地址已转换为经纬度（pickupLat / pickupLng 不为 null）
```



---



### **4\.5 map\-board**



\- **worktree**：\`feature/map\-board\`

\- **目标**：把订单点位、司机点位和侧边栏联动展示出来

\- **输入**：\`order\-import\` 写入的订单坐标、司机 mock 坐标、高德 JS API（Web 端 Key）

\- **输出**：



|产出|说明|
|---|---|
|地图主页面|`app/admin/map/page.tsx`|
|订单点位|按状态区分颜色，点击展示基础信息卡片|
|司机点位|mock 数据展示，标注状态 S1–S4|
|侧边栏联动|点选地图标记，右侧侧边栏同步显示详情|
|基础筛选|按订单状态、司机状态筛选显示|
|刷新机制|手动刷新按钮，弱实时（不做 WebSocket）|



\- **进入条件**：至少已有一批可展示的订单数据，司机数据可 mock

\- **退出条件**：地图稳定显示订单和司机点位，点选后侧边栏同步

\- **禁止修改**：不在此分支实现派单业务流



**Claude Code 指令模板**



```Plain Text
任务目标：实现地图看板基础展示与交互
范围：app/admin/map/、lib/map/、app/api/map/
不要修改：导入链路、调度 API、Prisma schema
输入：prisma/seed.ts 写入的订单和司机数据、高德 JS API 文档
输出：地图页可访问，订单和司机点位正确显示，点选联动正常
验收标准：
  1. 地图初始化无报错，中国地图正常加载
  2. seed 数据中的订单点位全部显示在地图上，颜色按状态区分
  3. 点击任意订单标记，右侧侧边栏显示该订单的订单号、状态、取车地址
  4. 司机点位用 mock 数据展示，标注 S1/S2/S3/S4 状态
  5. 手动刷新按钮点击后，点位重新加载不报错
```



---



### **4\.6 admin\-workflow**



\- **worktree**：\`feature/admin\-workflow\`

\- **目标**：让调度员能完成派单、改派、撤回的完整操作闭环

\- **输入**：\`docs/order\-lifecycle\.md\`（状态机）、\`data\-model\` 的 assignments 表、\`map\-board\` 的基础页面框架

\- **输出**：



|产出|说明|
|---|---|
|订单列表页|分页、状态筛选、搜索|
|订单详情页|完整字段展示 \+ 操作入口|
|派单动作|手动指定司机，写入 assignments，更新订单状态|
|改派动作|更换司机，记录原因，保留历史版本|
|撤回动作|订单回到待分配，司机解锁|
|操作日志展示|从 operation\_logs 读取，按时间倒序|



\- **进入条件**：订单可导入，地图可展示，data\-model 退出条件满足

\- **退出条件**：调度员可手工完成一次完整派单流程（导入→派单→改派→撤回）

\- **禁止修改**：不重写导入逻辑，不改地图底层



**Claude Code 指令模板**



```Plain Text
任务目标：实现调度员后台完整操作流程
范围：app/admin/orders/、app/api/orders/、app/api/assignments/
不要修改：地图页面结构、导入链路、Prisma schema 主体
输入：docs/order-lifecycle.md（状态流转规则）、prisma/schema.prisma（assignments 表结构）
输出：调度员可完成从订单列表到派单到改派的完整操作
验收标准：
  1. 订单列表页可按状态筛选，PENDING 状态订单正确显示
  2. 对一条 PENDING 订单完成派单操作，订单状态变为 ASSIGNED，assignments 表有对应记录
  3. 对已派单订单完成改派，operation_logs 记录原司机、新司机、改派原因
  4. 对已派单订单执行撤回，订单状态回到 PENDING，原司机 activeDoorOrders 或 activeStoreOrders 相应减少
  5. 操作日志页面按时间倒序展示所有操作记录
```



---



### **4\.7 dispatch\-rule\-v1**



\- **worktree**：\`feature/dispatch\-rule\-v1\`

\- **目标**：提供可解释、可人工兜底的推荐派单能力

\- **输入**：\`docs/dispatch\-rules\-v1\.md\`（规则口径）、\`admin\-workflow\` 完成的派单流程、高德驾车路径规划 API（服务端 Key）

\- **输出**：



|产出|说明|
|---|---|
|`lib/dispatch/types.ts`|DriverStatus、OrderType、RankedCandidate、DispatchResult|
|`lib/dispatch/filter.ts`|候选司机筛选（门店匹配、上门类单任务约束）|
|`lib/dispatch/eta.ts`|并行调用高德 API 计算 ETA，失败降级返回 9999|
|`lib/dispatch/sort.ts`|排序 \+ 负载惩罚 \+ 推荐理由生成|
|`lib/dispatch/constraints.ts`|超时控制（≥120 分钟 → MANUAL）、无司机（→ PENDING）|
|`lib/dispatch/engine.ts`|唯一对外入口 `runDispatch()`|
|`app/api/dispatch/recommend/route.ts`|POST 接口，接收 orderId，返回 DispatchResult|
|推荐结果展示|在 admin\-workflow 的派单操作页嵌入 Top N 推荐列表和推荐理由|



\- **进入条件**：\`admin\-workflow\` 退出条件满足（手工派单可用）

\- **退出条件**：系统能给出推荐列表，调度员仍能手工覆盖

\- **禁止修改**：不重做后台整体页面结构，不修改 admin\-workflow 的状态流转逻辑



**Claude Code 指令模板**



```Plain Text
任务目标：实现调度推荐引擎 V1
范围：lib/dispatch/（新建全部文件）、app/api/dispatch/recommend/route.ts、app/api/dispatch/confirm/route.ts
不要修改：admin-workflow 的派单页面主结构、Prisma schema、地图看板
输入：docs/dispatch-rules-v1.md（规则口径，以此为唯一依据）
输出：runDispatch() 可被 API Route 调用，返回带推荐理由的 DispatchResult
验收标准：
  1. POST /api/dispatch/recommend 传入有效 orderId，返回 { outcome: "DISPATCHED", topN: [...] }
  2. topN[0].reason 包含中文推荐理由（如"门店空闲，预计到达 8 分钟"）
  3. 数据库中无可用司机时返回 { outcome: "PENDING", reason: "NO_DRIVER" }
  4. 最优候选 ETA ≥ 120 分钟时返回 { outcome: "MANUAL", reason: "ETA_EXCEEDED" }
  5. 高德 API 调用失败时不抛异常，该司机 etaMinutes 降级为 9999，排在末尾
  6. confirm 接口使用 Prisma 事务写入 assignments，防止并发重复派单
```



---



### **4\.8 logging\-observe**



\- **worktree**：\`feature/logging\-observe\`

\- **目标**：让演示和排错过程可追踪

\- **输入**：核心接口（导入、派单、改派、撤回）、\`lib/logger\.ts\`（repo\-bootstrap 提供的基础封装）

\- **输出**：



|产出|说明|
|---|---|
|`trace_id` 贯穿|每个请求生成 UUID，写入响应头和日志|
|操作日志|导入、派单、改派、撤回均写入 operation\_logs|
|调度日志|runDispatch\(\) 记录：输入参数、候选数、ETA 结果、最终 outcome|
|错误日志|高德 API 失败、数据库异常统一 catch 并结构化输出|
|日志输出目标|stdout（Railway 控制台直接采集，无需额外配置）|



\- **进入条件**：核心接口（4\.4–4\.7）已基本成型

\- **退出条件**：导入、派单、改派、撤回的完整链路均有日志闭环

\- **禁止修改**：不因加日志而大改业务逻辑，只在关键节点插入日志调用



**Claude Code 指令模板**



```Plain Text
任务目标：为核心链路补充结构化日志和 trace_id
范围：lib/logger.ts（扩展）、lib/middleware/trace.ts（新建）、在导入/派单/改派/撤回的 API Route 中插入日志调用
不要修改：业务逻辑主体、Prisma schema、页面组件
输入：现有 API Route 文件列表、lib/logger.ts 当前实现
输出：四条核心链路均有结构化日志，包含 traceId、操作人、操作对象
验收标准：
  1. 执行一次订单导入，Railway 控制台（或本地 stdout）可看到含 traceId 的导入日志
  2. 执行一次派单，日志包含：orderId、driverId、traceId、操作结果
  3. 高德 API 返回非 200 时，错误日志包含：接口名、入参、返回状态码、traceId
  4. 任意接口响应头包含 X-Trace-Id 字段
```



---



### **4\.9 integration\-adapter**



\- **worktree**：\`feature/integration\-adapter\`

\- **目标**：为外部平台（哈啰 / GPS 厂商）预留统一适配层，现阶段用 mock 实现

\- **输入**：内部 orders / vehicles / driver\_locations 的 Prisma 类型、外部平台字段预期（当前以文档描述为准）

\- **输出**：



|产出|说明|
|---|---|
|`lib/adapters/types.ts`|内部 DTO 定义（OrderDTO、DriverLocationDTO、VehicleDTO）|
|`lib/adapters/haluo/`|哈啰适配器：外部 DTO \+ 映射器 \+ mock 实现|
|`lib/adapters/gps/`|GPS 厂商适配器：经纬度字段映射 \+ mock 实现，核心字段 lat / lng|
|接口契约说明|每个适配器导出标准接口，真实接入时只替换 mock 实现|



\- **进入条件**：内部领域模型（data\-model）稳定

\- **退出条件**：至少一套 mock 适配接口可跑通，注释说明真实接入时需替换的位置

\- **禁止修改**：不把业务逻辑写死到第三方字段结构里



**Claude Code 指令模板**



```Plain Text
任务目标：为哈啰和 GPS 厂商设计统一适配层（mock 实现）
范围：lib/adapters/（新建全部文件）
不要修改：业务逻辑、Prisma schema、任何页面
输入：prisma/schema.prisma（内部模型结构）
输出：mock 适配器可被 integration 测试调用，接口签名与真实接入时一致
验收标准：
  1. lib/adapters/haluo/index.ts 导出 fetchOrders() 方法，mock 返回至少 2 条订单 DTO
  2. lib/adapters/gps/index.ts 导出 fetchVehicleLocation(vehicleId) 方法，mock 返回 { lat, lng, updatedAt }
  3. 所有适配器函数有 JSDoc 注释，标明"真实接入时替换此实现"
  4. 内部 DTO 与 Prisma 类型之间的映射有单独的 mapper 函数，不直接使用第三方字段名
```



---



### **4\.10 driver\-workflow（V1 API 契约层）**



\- **worktree**：\`feature/driver\-workflow\`

\- **V1 策略**：不做完整小程序，只预留后端 API 和状态流转，用 Postman / curl 验收

\- **目标**：定义司机接单、开始、完成、位置上报的后端接口契约

\- **输入**：\`docs/order\-lifecycle\.md\`（状态机）、\`data\-model\` 的 drivers / assignments 表

\- **输出**：



|产出|说明|
|---|---|
|`app/api/driver/tasks/route.ts`|获取当前司机任务列表|
|`app/api/driver/tasks/[id]/accept/route.ts`|接单，更新状态 ASSIGNED → IN\_PROGRESS|
|`app/api/driver/tasks/[id]/complete/route.ts`|完成，更新状态 IN\_PROGRESS → COMPLETED|
|`app/api/driver/location/route.ts`|位置上报，写入 driver\_locations|
|Postman 用例|覆盖以上 4 个接口的正常和异常场景|



\- **进入条件**：\`admin\-workflow\` 退出条件满足（后台派单稳定）

\- **退出条件**：后台可通过 Postman 模拟司机接单和完单，全链路状态流转正确

\- **禁止修改**：不在 V1 投入精力做小程序 UI



**Claude Code 指令模板**



```Plain Text
任务目标：实现司机端后端 API 契约（V1 不做小程序）
范围：app/api/driver/（新建全部文件）
不要修改：调度员后台 API、dispatch 引擎、Prisma schema
输入：docs/order-lifecycle.md（司机侧状态流转部分）
输出：4 个 API 可通过 curl 或 Postman 调用，状态流转符合文档定义
验收标准：
  1. POST /api/driver/tasks/{id}/accept 成功后，assignments 状态变为 IN_PROGRESS，司机状态变为 S4
  2. POST /api/driver/tasks/{id}/complete 成功后，order 状态变为 COMPLETED，司机状态回到 S1
  3. POST /api/driver/location 成功写入 driver_locations 表，包含 lat / lng / timestamp
  4. 非法状态流转（如已完成的订单再次接单）返回 400 和可读的错误信息
```



---



### **4\.11 stabilization**



\- **worktree**：\`feature/stabilization\`（临时分支，演示后删除）

\- **目标**：联调、修 bug、封板、准备演示

\- **输入**：所有 V1 已合并到 develop 的能力

\- **输出**：



|产出|说明|
|---|---|
|缺陷修复|按优先级修复影响演示的问题|
|回滚说明|Railway 回滚操作步骤文档|
|演示脚本|逐步操作说明（见第 6 节）|
|演示账号|调度员账号 \+ mock 司机数据|
|演示数据|可演示的订单、司机、派单记录|



\- **进入条件**：V1 主链路（导入 → 地图 → 派单 → 推荐）已在 develop 打通

\- **退出条件**：演示脚本可从头到尾跑通，无阻断性 bug

\- **禁止修改**：封板阶段不引入新模块，不做大重构



**Claude Code 指令模板**



```Plain Text
任务目标：联调修复和演示收尾
范围：仅修复影响演示流程的 bug，不新增功能模块
不要修改：已稳定的核心逻辑（除非有阻断性 bug）
输入：演示脚本（第 6 节）、当前已知问题列表
输出：演示脚本可完整执行，输出回归清单和演示前检查清单
验收标准：
  1. 按第 6 节演示脚本从头执行，无任何步骤报错或卡住
  2. 演示账号可正常登录，演示数据已就位
  3. 输出"演示前检查清单"，包含：环境变量检查、数据库连接检查、高德 API 可用性检查
  4. Railway 回滚步骤已记录在 docs/runbook.md
```



---



## **5\. V1 验收口径**



### **5\.1 最小成功标准**



* [ ] 可以登录系统

* [ ] 可以导入订单

* [ ] 可以在地图上看到订单与司机点位

* [ ] 调度员可以完成派单或改派

* [ ] 推荐引擎可以给出 Top N 推荐列表和推荐理由

* [ ] 系统可以留下操作日志



### **5\.2 允许 mock 的部分**



- 司机实时位置（用最后上报位置代替）

- 外部平台订单同步（哈啰 API）

- GPS 厂商接入（用 mock 适配器）

- 完整小程序端（用 Postman 模拟司机操作）

### **5\.3 不允许缺失的部分**



- 订单状态机完整流转

- 基础数据模型（六张表）

- 手动导入链路

- 地图基础展示

- 调度员操作闭环（派单 / 改派 / 撤回）

- 推荐引擎基础能力（筛选 \+ ETA 排序 \+ 推荐理由）

---



## **6\. 推荐演示脚本**



```Plain Text
Step 1  登录系统（调度员账号）
Step 2  导入订单（上传标准 Excel 模板，5 条数据）
Step 3  打开地图看板，查看订单点位和司机点位
Step 4  点击任意订单标记，查看订单详情卡片
Step 5  进入订单列表，对 PENDING 订单触发推荐派单
Step 6  查看 Top N 推荐列表和推荐理由，确认派单
Step 7  对已派单订单执行改派，填写改派原因
Step 8  查看操作日志，确认全链路留痕
```



---



## **7\. 分支合并路径总览**



```Plain Text
feature/docs-prd        ─┐
feature/repo-bootstrap   ├─→ develop ─→ main
feature/data-model       │
feature/order-import     │   (每个 feature 退出条件满足后合 develop)
feature/map-board        │   (develop 联调稳定后合 main)
feature/admin-workflow   │
feature/dispatch-rule-v1 │
feature/logging-observe  │
feature/integration-adapter
feature/driver-workflow ─┘

develop ──────────────────→ main ──→ release/mvp-demo（演示封板）
```



---



## **8\. 当前建议开工顺序**



|时间|目标|
|---|---|
|今天|补完 `docs/import-template.md` 第 4 条；重命名两份文档入库；确认 Railway 为部署方案|
|本周前半|完成 `feature/docs-prd`（5 份文档全部冻结）|
|本周后半|完成 `feature/repo-bootstrap`（工程可启动可连库）|
|下周|完成 `feature/data-model`；开始 `feature/order-import`|
|再下一步|`feature/map-board` \+ `feature/admin-workflow` 并行（各自 worktree 隔离）|
|之后|`feature/dispatch-rule-v1` → `feature/logging-observe` → `feature/stabilization`|



---



## **9\. 一句话原则**



- `worktree` 是隔离单元

- `IDE（Trae / VS Code）` 是观察和 review 单元

- `Claude Code` 是当前分支的实施助手

- `CLI（Warp）` 是分支和环境操作单元

坚持这四层分工，每次只打开一个 worktree，每次只给 Claude Code 一个问题域，项目推进会非常稳。




# 人车单项目 V1 历史基线索引

> 归档版本戳：`RCD-V1-ARCHIVE-20260713`  
> 状态：历史只读  
> 原则：不删除、不改名、不覆盖原文件

## V1 正式业务材料

| 类型 | 原文件 | V2 使用方式 |
|---|---|---|
| PRD v1.3 | `.claude/worktrees/prod-infra-setup/feature-docs-prd/人车单调度系统_MVP_PRD_20260426_v1.3_对齐版.md` | 仅解释现有 V1 代码 |
| 领域术语 | `.claude/worktrees/prod-infra-setup/feature-docs-prd/docs/domain-glossary.md` | 旧枚举追溯 |
| 订单生命周期 | `.claude/worktrees/prod-infra-setup/feature-docs-prd/docs/order-lifecycle.md` | 旧状态机追溯 |
| 调度规则 | `.claude/worktrees/prod-infra-setup/feature-dispatch-rule-v1/dispatch-rules-v1.md` | 旧 Top N 引擎追溯 |
| 开发主线 | `skill/人车单项目 V1 Worktree 执行蓝图_final.md` | 现有阶段与验收追溯 |

## V1 项目级约束和设计材料

| 类型 | 原文件 | 归档判断 |
|---|---|---|
| Codex 工程规则 | `AGENTS.md` | 技术铁律继续有效；V1 业务阶段名只用于旧主线 |
| Claude 工程规则 | `CLAUDE.md` | 同上 |
| V1 代码审查 | `skill/mvp代码审查SKILL.md` | 不直接判断 V2 业务正确性 |
| 产品视觉基调 | `PRODUCT.md` | 视觉性格继续有效，业务描述由 V2 替换 |
| UI/UX 规格 | `docs/demo-v12-ui-ux-spec.md` | 保留视觉变量，Top N 等交互由 V2 覆盖 |
| 设计参数 | `feature-admin-workflow/.extract-design-system/demo_v12-design-parameters.md` | 作为 token 数值来源 |
| API 契约 | `docs/demo-v12-api-contract.md` | 统一响应等通用规则保留，业务 DTO 需升级 |
| 字段映射 | `docs/production-field-mapping.md` | 作为 Adapter V1 输入 |
| RDS/插件方案 | `人车单-RDS-浏览器插件-字段对接优化方案.md` | 作为订单来源过渡方案 |
| 位置协议 | `docs/production-location-protocol.md` | 可复用部分进入 V2 |
| 高德策略 | `docs/production-amap-strategy.md` | 可复用部分进入 V2 |
| Tair Key | `docs/production-tair-key-design.md` | 可复用部分进入 V2 |

## V1 与 V2 的硬边界

以下 V1 规则不得继续推导 V2 新功能：

- Top N 推荐后由调度员确认；V2 改为自动排入 A/B/C，调度员保留改派权。
- 司机“接单/拒单”；V2 司机无拒单权，也不以接单确认作为主流程。
- 车辆参与订单匹配；V2 车辆只展示，不进入匹配评分。
- ETA 大于等于 120 分钟转人工；V2 改为预计迟到超过 30 分钟即不可行预警。
- 3–5 分钟定位和手动刷新；V2 使用实时定位、事件触发重算与 10 分钟基线检查。
- 单订单推荐；V2 仅优化每名司机当前及未来两个订单。

历史代码仍可保留这些枚举和接口，直到 V2 数据迁移阶段提供兼容映射。禁止为了“看起来统一”提前删除 V1 文件或状态。


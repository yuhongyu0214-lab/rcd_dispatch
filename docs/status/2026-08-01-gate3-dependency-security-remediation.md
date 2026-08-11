# Gate 3 依赖安全返修证据

> 文档类型：`STATUS / EVIDENCE`
>
> 日期：2026-08-01
>
> 当前对齐候选：`codex/v2-gate3-app-candidate @ 958afca537b412fb972b6e180561a9b37022834d`
>
> 结论：`PASS`

## 1. 返修范围

- Next.js 锁定为 `15.5.21`，React / React DOM 锁定为 `19.2.8`；
- Excel 解析改用 SheetJS 官方 CDN `xlsx 0.20.3`，不再使用 npm `xlsx 0.18.x`；
- 保留经过审计的精确 `pnpm.overrides`，锁定已修复的传递依赖；
- 移除当前运行路径不需要的 Next.js 可选 `sharp` 包；
- 按 Next.js 15 规则适配异步 `params`、`searchParams` 与 `cookies()`，不改变外部 HTTP 契约。

框架、依赖来源和兼容边界的权威裁决见[应用框架与依赖决策日志](../versions/v2.0/application-decision-log.md)，工程约束见[项目规则 V2](../versions/v2.0/project-rules-v2.md)。

## 2. 验收证据

2026-08-01 应用候选完成以下验证：

| 检查 | 结果 |
|---|---|
| 完整依赖审计 | 0 个已知漏洞 |
| 自动化回归 | 462 项通过，7 项条件跳过 |
| lint / 类型检查 / Prisma / 生产构建 | 全部通过 |
| Schema、业务枚举与 migration | 未因框架适配改变 |
| 外部 HTTP 方法、路径、鉴权、DTO、状态码、错误码、traceId | 未改变 |

原候选汇总见[应用候选 SHA 收口](2026-08-01-gate3-app-candidate.md)。后续部署、可观测性、Gate 3 最小 E2E、ETA/H5 和全实例高德 `3 QPS` 限流返修均未改变依赖基线；当前候选 `958afca…` 继续沿用上述已审计版本与来源。

## 3. 复验与失败判定

发生以下任一变化时，必须重新执行完整依赖审计、回归、lint、类型检查、Prisma 校验和生产构建：

- Next.js、React、SheetJS 或其他直接依赖版本变化；
- SheetJS 下载来源变化；
- `pnpm.overrides` 增删或版本变化；
- 锁文件变化导致解析出的依赖树变化。

出现已知高危漏洞、依赖来源未固定、使用 npm `xlsx 0.18.x`、外部契约漂移或任一质量检查失败，均判定依赖安全子闸门失败。

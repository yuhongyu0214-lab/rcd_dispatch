# 2026-08-09 Gate 3-R 最小 E2E 返修候选

> 文档类型：`REPORT / STATUS_EVIDENCE`
> 结论：`READY_FOR_PHASED_PREPROD_DEPLOYMENT`
> 权威边界：只记录返修代码、回归、镜像和部署前状态；不定义产品、API、Schema 或调度规则
> 最终代码候选：`08d84cfc6624dc1e29f24b75f715550718067fb1`
> 最终镜像：`sha256:04ea40c46cfa7eb6f6bd6a08b3bc2d74d547efcf0ab296bd641f3bd3f2ac1376`
> 文档同步时的 ECS 运行基线：`7595a649e166e78bc4936d16e84e478bbc659309@sha256:2734a7fe5d96744523f71ab73a3d5efc74643099501489ccf0845808dd6f5844`

## 1. 返修范围

- ETA 必要路段失败增加结构化诊断，并对 `ETA_UNAVAILABLE` 零变化结果进行受控重试；保持幂等，禁止假 ETA。
- `GET /api/v2/driver/map` 与调度快照统一读取司机最新位置，并保留新鲜、过期、低精度和非本人反例。
- H5 按四类 `businessType` 只显示业务相关的一个导航入口；隐藏入口不保留坐标缺失占位。
- H5 展示层过滤 `[G3E2E]` 开头的测试标记，不修改底层业务事实或审计证据。
- 未修改 Schema、9 个 migration、V2 DTO、外部 HTTP 契约、枚举、依赖和设计变量。

## 2. 代码与测试证据

- 实现提交：`f8eb64a57b0da3d328a78e06c068baa2421503c0`。
- 最终测试补强提交：`08d84cfc6624dc1e29f24b75f715550718067fb1`；本地 HEAD、GitHub 远端分支一致，工作区干净。
- H5 定向回归：`13/13` 通过，覆盖四类订单按钮、取还车坐标缺失反例和测试标记过滤。
- 全量 Vitest：`511 passed / 7 skipped`；测试文件 `53 passed / 3 skipped`。
- `pnpm lint` 通过；生产构建通过，生成 29 个页面/路由入口。
- 相对 `7595a649…` 的冻结范围核验：Schema、migration、V2 DTO、`package.json` 和锁文件差异为 `0`。

## 3. 镜像证据

```text
tag: 08d84cfc6624dc1e29f24b75f715550718067fb1
index digest: sha256:04ea40c46cfa7eb6f6bd6a08b3bc2d74d547efcf0ab296bd641f3bd3f2ac1376
linux/amd64 manifest: sha256:ff464f61a558b8d7a225ab1038985a3e0d57feff006e62f4ef872889298f7bc9
attestation manifest: sha256:e440d43e63e0ddb02e59a4f18599cee11055c831b76f1b89766890256425e737
```

- 本机镜像标签中的 `org.opencontainers.image.revision` 与完整 Git SHA 一致。
- 临时容器启动成功，`GET /api/v2/health` 返回 `200 / status=ok`；容器随后已删除。
- ACR 远端已核验 `linux/amd64` 运行清单；`unknown/unknown` 仅为 attestation，不是运行平台。
- 一条使用错误完整 SHA `08d84cf201832f86c94d77b5efc5c459643171f3` 的镜像曾被推送，但该 SHA 不存在于当前 Git 候选，已明确废弃且禁止部署；其摘要不得作为回退或验收依据。

## 4. 部署与重验边界

- 文档同步时，新候选尚未进入 ECS；预生产 app、worker 仍运行 `7595a649…@sha256:2734…5844`。
- 下一步只允许按现有 Compose 分阶段更新 app、健康检查通过后再更新 HTTP-only 单副本 worker；Nginx 不变。
- 禁止执行 migration、重复写入 G3E2E R2.2 基础资料、清理首轮三单失败样本或直接写业务数据库。
- app、worker 的 SHA、digest、健康和外部入口一致后，才可从冻结的真实 10 单流程重新开始；任一失败立即停止。

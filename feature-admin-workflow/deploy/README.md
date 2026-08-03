# Gate 3 应用部署包

本目录只固化应用候选的本地可部署形态，不授权创建或修改任何云资源。

## 不可变镜像

从干净且已批准的 commit 构建一次镜像。构建必须传入该完整 Git SHA；两个高德前端参数是公开构建参数，不得把数据库、Redis、JWT、worker 或高德服务端秘密作为构建参数。

```text
docker build \
  --build-arg GIT_COMMIT_SHA=<full-git-sha> \
  --build-arg NEXT_PUBLIC_AMAP_JS_KEY=<public-js-key> \
  --build-arg NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=<public-security-code> \
  --tag <approved-acr-image>:<full-git-sha> \
  .
```

发布记录必须保存 ACR digest；`latest` 不得作为唯一追溯标签。

## 三种应用角色

`compose.preprod.yml` 对 app、worker、migration 只接受同一个 `RCD_IMAGE_REF`：

| 角色 | 启动命令 | 秘密边界 |
|---|---|---|
| app | `node server.js` | app 业务数据库、Redis/Tair、会话、司机、ingest、内部任务和高德服务端配置 |
| worker | `node scripts/dispatch-event-worker.mjs` | 仅内部 origin、`INTERNAL_CRON_SECRET`、日志级别 |
| migration | `prisma migrate deploy` | 仅迁移窗口的 `MIGRATION_DATABASE_URL`；不配置 shadow、Redis 或高德 |

标准顺序是：先一次性启动 migration 并确认成功，再启动 app，验证匿名 `/api/v2/health` 和受保护 `/api/v2/health/readiness`，最后启动单副本 worker 与 Nginx。任何一步失败立即停止。

所有常驻服务均受 Compose profile 保护；裸执行 `docker compose up -d` 不会选择任何业务服务。必须逐步执行：

```bash
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  config --quiet
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile migration run --rm migration
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile app up -d app
# 人工验证 liveness 与 readiness，确认成功后才继续
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile worker up -d worker
docker compose --env-file <受控配置文件> \
  -f deploy/compose.preprod.yml \
  --profile edge up -d nginx
```

app 的 Compose 健康检查使用受保护 readiness；worker 与 Nginx 只在 app 的数据库、Redis/Tair 和高德依赖全部就绪后启动。禁止使用 `--profile "*"` 或同时启用全部 profile 绕过上述顺序。

Nginx 只把 app 暴露到公网，内部 outbox 处理端点固定返回 404。外部 `X-Trace-Id` 仅在符合受控字符集且长度不超过 128 时透传，否则由 Nginx 使用 `$request_id` 重建。真实域名、证书文件、镜像地址和所有秘密只能来自获准的预生产配置或秘密托管，不得写回本目录。

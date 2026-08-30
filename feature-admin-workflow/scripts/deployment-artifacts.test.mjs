import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("deployment artifacts", () => {
  it("builds a non-root standalone image without embedding runtime secrets", async () => {
    const [dockerfile, dockerignore, nextConfigSource, packageJsonSource] = await Promise.all([
      readProjectFile("Dockerfile"),
      readProjectFile(".dockerignore"),
      readProjectFile("next.config.mjs"),
      readProjectFile("package.json")
    ]);
    const packageJson = JSON.parse(packageJsonSource);
    const pinnedNodeImage =
      "node:22.23.1-bookworm-slim@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27";

    expect(nextConfigSource).toContain("NEXT_OUTPUT_STANDALONE");
    expect(nextConfigSource).toContain('output: "standalone"');
    expect(dockerfile.split(`FROM ${pinnedNodeImage}`).length - 1).toBe(2);
    expect(dockerfile).toContain("NEXT_OUTPUT_STANDALONE=true");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm install --prod --no-optional --frozen-lockfile");
    expect(dockerfile).toContain("pnpm exec prisma generate");
    expect(
      dockerfile.match(
        /apt-get install --yes --no-install-recommends ca-certificates openssl/g
      )
    ).toHaveLength(2);
    expect(dockerfile.match(/apt-get upgrade --yes/g)).toHaveLength(2);
    expect(dockerfile).toContain("ge '3.7.9-2+deb12u7'");
    expect(dockerfile).toContain(
      "COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules"
    );
    expect(dockerfile).toContain("FROM builder AS standalone-artifacts");
    expect(dockerfile).toContain("rm -rf /app/.next/standalone/node_modules");
    expect(dockerfile).toContain(
      "COPY --from=standalone-artifacts --chown=nextjs:nodejs /app/.next/standalone ./"
    );
    expect(dockerfile).not.toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules"
    );
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("/usr/local/lib/node_modules/corepack");
    expect(dockerfile).not.toContain("esbuild");
    expect(packageJson.dependencies.prisma).toBe("^6.7.0");
    expect(packageJson.devDependencies.prisma).toBeUndefined();
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("/api/v2/health");
    expect(dockerfile).not.toContain("DATABASE_URL");
    expect(dockerfile).not.toContain("REDIS_URL");
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
  });

  it("uses one application image while keeping worker and migration secrets isolated", async () => {
    const [compose, appLogger, workerSource] = await Promise.all([
      readProjectFile("deploy/compose.preprod.yml"),
      readProjectFile("src/lib/logger.ts"),
      readProjectFile("scripts/dispatch-event-worker.mjs")
    ]);
    const applicationImageUses = compose.match(/image: \$\{RCD_IMAGE_REF:/g) ?? [];
    const appBlock = compose.match(/\n  app:[\s\S]*?\n  worker:/)?.[0] ?? "";
    const workerBlock = compose.match(/\n  worker:[\s\S]*?\n  migration:/)?.[0] ?? "";
    const migrationBlock = compose.match(/\n  migration:[\s\S]*?\n  nginx:/)?.[0] ?? "";
    const nginxBlock = compose.match(/\n  nginx:[\s\S]*?\nnetworks:/)?.[0] ?? "";

    expect(applicationImageUses).toHaveLength(3);
    expect(appBlock).toContain('profiles: ["app", "worker", "edge"]');
    expect(appBlock).toContain("/api/v2/health/readiness");
    expect(appBlock).toContain("X-Internal-Key");
    expect(workerBlock).toContain('profiles: ["worker"]');
    expect(workerBlock).toContain("condition: service_healthy");
    expect(workerBlock).toContain("DISPATCH_EVENT_WORKER_ORIGIN");
    expect(workerBlock).toContain("DISPATCH_EVENT_WORKER_HEARTBEAT_PATH");
    expect(workerBlock).toContain("dispatch-event-worker-heartbeat");
    expect(workerBlock).toContain("isDispatchWorkerHeartbeatFresh");
    expect(workerBlock).toContain("start_period: 90s");
    expect(workerBlock).not.toContain("/api/v2/health");
    expect(workerBlock).not.toContain("DATABASE_URL");
    expect(workerBlock).not.toContain("REDIS_URL");
    expect(workerBlock).not.toContain("AMAP_SERVER_KEY");
    expect(appBlock).toContain('RCD_DEPLOYMENT_ENV: "preprod"');
    expect(workerBlock).toContain('RCD_DEPLOYMENT_ENV: "preprod"');
    expect(nginxBlock).toContain('RCD_DEPLOYMENT_ENV: "preprod"');
    expect(compose.match(/RCD_RELEASE_REVISION: \$\{RCD_RELEASE_REVISION:/g)).toHaveLength(3);
    expect(appLogger).toContain('service: "app"');
    expect(appLogger).toContain("process.env.RCD_DEPLOYMENT_ENV");
    expect(appLogger).toContain("process.env.RCD_RELEASE_REVISION");
    expect(appLogger).toContain("return { level: label }");
    expect(workerSource).toContain('service: "worker"');
    expect(workerSource).toContain("process.env.RCD_DEPLOYMENT_ENV");
    expect(workerSource).toContain("process.env.RCD_RELEASE_REVISION");
    expect(workerSource).toContain("return { level: label }");
    expect(compose.match(/max-size: "20m"/g)).toHaveLength(3);
    expect(compose.match(/max-file: "5"/g)).toHaveLength(3);
    expect(migrationBlock).toContain("MIGRATION_DATABASE_URL");
    expect(migrationBlock).not.toContain("SHADOW_DATABASE_URL");
    expect(migrationBlock).not.toContain("REDIS_URL");
    expect(nginxBlock).toContain('profiles: ["edge"]');
    expect(nginxBlock).toContain("condition: service_healthy");
  });

  it("keeps the internal worker endpoint off the public Nginx surface", async () => {
    const nginx = await readProjectFile("deploy/nginx/rcd.conf.template");

    expect(nginx).toContain("proxy_pass http://rcd_app");
    expect(nginx).toMatch(
      /location = \/api\/v2\/system\/dispatch-events\/process \{\s*return 404;/
    );
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr");
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
    expect(nginx).toContain("map $http_x_trace_id $rcd_trace_id");
    expect(nginx).toContain("default $request_id");
    expect(nginx).toContain("log_format rcd_json escape=json");
    expect(nginx).toContain('"environment":"${RCD_DEPLOYMENT_ENV}"');
    expect(nginx).toContain('"service":"nginx"');
    expect(nginx).toContain('"revision":"${RCD_RELEASE_REVISION}"');
    expect(nginx).toContain('"traceId":"$rcd_trace_id"');
    expect(nginx).toContain('"time":"$time_iso8601"');
    expect(nginx).toContain('"level":"info"');
    expect(nginx).toContain('"path":"$uri"');
    expect(nginx).not.toContain('"path":"$request_uri"');
    expect(nginx).toContain("access_log /dev/stdout rcd_json;");
    expect(
      nginx.match(/proxy_set_header X-Trace-Id \$rcd_trace_id;/g)
    ).toHaveLength(2);
    expect(nginx).not.toContain(
      "proxy_set_header X-Trace-Id $http_x_trace_id"
    );
  });

  it("documents the required staged Compose startup order", async () => {
    const deploymentReadme = await readProjectFile("deploy/README.md");

    expect(
      deploymentReadme.match(
        /docker compose --env-file <受控配置文件> \\\r?\n  -f deploy\/compose\.preprod\.yml \\/g
      )
    ).toHaveLength(5);
    expect(deploymentReadme).toContain("  config --quiet");
    expect(deploymentReadme).toContain(
      "  --profile migration run --rm migration"
    );
    expect(deploymentReadme).toContain(
      "  --profile app up -d app"
    );
    expect(deploymentReadme).toContain(
      "  --profile worker up -d worker"
    );
    expect(deploymentReadme).toContain(
      "  --profile edge up -d nginx"
    );
    expect(deploymentReadme).toContain("RCD_RELEASE_REVISION");
    expect(deploymentReadme).toContain("完整 Git SHA");
  });
});

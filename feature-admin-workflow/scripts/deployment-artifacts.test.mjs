import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("deployment artifacts", () => {
  it("builds a non-root standalone image without embedding runtime secrets", async () => {
    const [dockerfile, dockerignore, nextConfigSource] = await Promise.all([
      readProjectFile("Dockerfile"),
      readProjectFile(".dockerignore"),
      readProjectFile("next.config.mjs")
    ]);

    expect(nextConfigSource).toContain("NEXT_OUTPUT_STANDALONE");
    expect(nextConfigSource).toContain('output: "standalone"');
    expect(dockerfile).toContain("NEXT_OUTPUT_STANDALONE=true");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm exec prisma generate");
    expect(
      dockerfile.match(
        /apt-get install --yes --no-install-recommends ca-certificates openssl/g
      )
    ).toHaveLength(2);
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("/api/v2/health");
    expect(dockerfile).not.toContain("DATABASE_URL");
    expect(dockerfile).not.toContain("REDIS_URL");
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
  });

  it("uses one application image while keeping worker and migration secrets isolated", async () => {
    const compose = await readProjectFile("deploy/compose.preprod.yml");
    const applicationImageUses = compose.match(/image: \$\{RCD_IMAGE_REF:/g) ?? [];
    const workerBlock = compose.match(/\n  worker:[\s\S]*?\n  migration:/)?.[0] ?? "";
    const migrationBlock = compose.match(/\n  migration:[\s\S]*?\n  nginx:/)?.[0] ?? "";

    expect(applicationImageUses).toHaveLength(3);
    expect(workerBlock).toContain("DISPATCH_EVENT_WORKER_ORIGIN");
    expect(workerBlock).not.toContain("DATABASE_URL");
    expect(workerBlock).not.toContain("REDIS_URL");
    expect(workerBlock).not.toContain("AMAP_SERVER_KEY");
    expect(migrationBlock).toContain("MIGRATION_DATABASE_URL");
    expect(migrationBlock).not.toContain("SHADOW_DATABASE_URL");
    expect(migrationBlock).not.toContain("REDIS_URL");
  });

  it("keeps the internal worker endpoint off the public Nginx surface", async () => {
    const nginx = await readProjectFile("deploy/nginx/rcd.conf.template");

    expect(nginx).toContain("proxy_pass http://rcd_app");
    expect(nginx).toMatch(
      /location = \/api\/v2\/system\/dispatch-events\/process \{\s*return 404;/
    );
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr");
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
  });
});

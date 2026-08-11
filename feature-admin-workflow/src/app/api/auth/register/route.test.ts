import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register", () => {
  it("fails closed in production even when the development switch is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_ADMIN_REGISTRATION", "true");

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "X-Trace-Id": "trace-register-closed" },
        body: JSON.stringify({})
      })
    );
    const payload = (await response.json()) as {
      success: boolean;
      error: string;
      traceId: string;
    };

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      error: "公开注册已关闭",
      traceId: "trace-register-closed"
    });
  });
});

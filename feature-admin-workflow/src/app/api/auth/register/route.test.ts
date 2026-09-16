import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async () => "test-hash")
}));
vi.mock("@/lib/auth/workspace-account", async (original) => ({
  ...(await original<typeof import("@/lib/auth/workspace-account")>()),
  createWorkspaceAccount: vi.fn()
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() })
}));

import { createWorkspaceAccount } from "@/lib/auth/workspace-account";

import { POST } from "./route";

const INVITATION_SECRET = "test-invitation-secret-with-at-least-32-characters";

function createInvitation(
  phone: string,
  expiresAt = Math.floor(Date.now() / 1000) + 3600
) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      phone,
      expiresAt,
      nonce: "test-invitation-nonce"
    })
  ).toString("base64url");
  const signedValue = `v1.${payload}`;
  const signature = createHmac("sha256", INVITATION_SECRET)
    .update(signedValue)
    .digest("base64url");
  return `${signedValue}.${signature}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ALLOW_PUBLIC_ADMIN_REGISTRATION", "true");
  vi.stubEnv("WORKSPACE_REGISTRATION_INVITE_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register", () => {
  it("always provisions both identities, ignoring role and alsoDriver opt-outs", async () => {
    vi.mocked(createWorkspaceAccount).mockResolvedValue({
      id: "user-1",
      email: "19900000011@dispatch.local",
      phone: "19900000011",
      name: "测试用户",
      role: "dispatcher",
      driverId: "driver-1"
    });
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          account: "199 0000 0011",
          name: " 测试用户 ",
          password: "test-only",
          storeId: "store-1",
          role: "system",
          alsoDriver: false
        })
      })
    );
    expect(response.status).toBe(201);
    expect(createWorkspaceAccount).toHaveBeenCalledWith({
      phone: "19900000011",
      name: "测试用户",
      passwordHash: "test-hash",
      storeId: "store-1"
    });
    expect(await response.json()).toMatchObject({
      success: true,
      data: { role: "dispatcher", driverId: "driver-1" }
    });
  });
  it.each([
    {},
    null,
    { account: 123 },
    { account: "19900000011", password: "test", name: "用户" }
  ])("rejects missing or invalid registration fields %j", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );
    expect(response.status).toBe(400);
    expect(createWorkspaceAccount).not.toHaveBeenCalled();
  });
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

  it("accepts a valid phone-bound invitation in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_ADMIN_REGISTRATION", "false");
    vi.stubEnv("WORKSPACE_REGISTRATION_INVITE_SECRET", INVITATION_SECRET);
    vi.mocked(createWorkspaceAccount).mockResolvedValue({
      id: "user-invited",
      email: "19900000011@dispatch.local",
      phone: "19900000011",
      name: "受邀用户",
      role: "dispatcher",
      driverId: "driver-invited"
    });

    const response = await POST(
      new Request("https://dispatch.example/api/auth/register", {
        method: "POST",
        headers: { Origin: "https://dispatch.example" },
        body: JSON.stringify({
          account: "19900000011",
          name: "受邀用户",
          password: "test-only",
          storeId: "store-1",
          inviteCode: createInvitation("19900000011")
        })
      })
    );

    expect(response.status).toBe(201);
    expect(createWorkspaceAccount).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed", "not-an-invitation"],
    ["different phone", createInvitation("19900000012")],
    [
      "expired",
      createInvitation("19900000011", Math.floor(Date.now() / 1000) - 1)
    ]
  ])("rejects a %s invitation without creating an account", async (_name, inviteCode) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_ADMIN_REGISTRATION", "false");
    vi.stubEnv("WORKSPACE_REGISTRATION_INVITE_SECRET", INVITATION_SECRET);

    const response = await POST(
      new Request("https://dispatch.example/api/auth/register", {
        method: "POST",
        headers: { Origin: "https://dispatch.example" },
        body: JSON.stringify({
          account: "19900000011",
          name: "受邀用户",
          password: "test-only",
          storeId: "store-1",
          inviteCode
        })
      })
    );

    expect(response.status).toBe(403);
    expect(createWorkspaceAccount).not.toHaveBeenCalled();
  });

  it("rejects a cross-site invitation request before account creation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_ADMIN_REGISTRATION", "false");
    vi.stubEnv("WORKSPACE_REGISTRATION_INVITE_SECRET", INVITATION_SECRET);

    const response = await POST(
      new Request("https://dispatch.example/api/auth/register", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
        body: JSON.stringify({
          account: "19900000011",
          name: "受邀用户",
          password: "test-only",
          storeId: "store-1",
          inviteCode: createInvitation("19900000011")
        })
      })
    );

    expect(response.status).toBe(403);
    expect(createWorkspaceAccount).not.toHaveBeenCalled();
  });
});

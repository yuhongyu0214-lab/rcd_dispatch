import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/workspace-account", async (original) => ({
  ...(await original<typeof import("@/lib/auth/workspace-account")>()),
  completeWorkspaceDriver: vi.fn()
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() })
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import {
  completeWorkspaceDriver,
  WorkspaceAccountError
} from "@/lib/auth/workspace-account";
import { POST } from "./route";

const user = {
  id: "session-user",
  role: "admin",
  driverId: null,
  email: "test@invalid.example",
  name: "测试"
};
function request(
  body: unknown = { storeId: "store-1" },
  headers: Record<string, string> = {},
  url = "https://preprod.test/api/v2/account/driver-profile"
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Trace-Id": "profile-trace",
      ...headers
    },
    body: JSON.stringify(body)
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  vi.mocked(completeWorkspaceDriver).mockResolvedValue({
    driverId: "driver-own"
  });
});
describe("POST /api/v2/account/driver-profile", () => {
  it.each(["admin", "dispatcher", "driver"])(
    "completes only the session-bound %s account",
    async (role) => {
      vi.mocked(getCurrentUser).mockResolvedValue({ ...user, role });
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(completeWorkspaceDriver).toHaveBeenCalledWith(
        "session-user",
        "store-1"
      );
      expect(await response.json()).toMatchObject({
        success: true,
        data: { driverId: "driver-own" },
        traceId: "profile-trace"
      });
      expect(response.headers.get("X-Trace-Id")).toBe("profile-trace");
    }
  );
  it("accepts HTTPS browser origin behind the existing TLS-terminating proxy", async () => {
    const response = await POST(
      request(
        {},
        { host: "preprod.test", origin: "https://preprod.test" },
        "http://app:3000/api/v2/account/driver-profile"
      )
    );
    expect(response.status).toBe(200);
    expect(completeWorkspaceDriver).toHaveBeenCalledWith(
      "session-user",
      undefined
    );
  });
  it.each([
    ["origin", "https://evil.test"],
    ["origin", "null"],
    ["sec-fetch-site", "cross-site"],
    ["origin", "https://preprod.test.evil.test"]
  ])("rejects cross-origin submissions %s=%s", async (header, value) => {
    expect((await POST(request({}, { [header]: value }))).status).toBe(403);
    expect(completeWorkspaceDriver).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { storeId: 1 },
    { phone: "someone-else" },
    { userId: "someone-else" },
    { driverId: "someone-else" }
  ])("rejects invalid or spoofed identity fields %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(completeWorkspaceDriver).not.toHaveBeenCalled();
  });
  it("requires JSON instead of a cross-site form", async () => {
    expect(
      (await POST(request({}, { "content-type": "text/plain" }))).status
    ).toBe(400);
    expect(completeWorkspaceDriver).not.toHaveBeenCalled();
  });
  it("requires a logged-in account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(completeWorkspaceDriver).not.toHaveBeenCalled();
  });
  it("does not admit service identities even if linked", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...user,
      role: "system",
      driverId: "driver-own"
    });
    expect((await POST(request())).status).toBe(403);
    expect(completeWorkspaceDriver).not.toHaveBeenCalled();
  });
  it.each([400, 403, 409] as const)(
    "reports domain failure %s without success",
    async (status) => {
      vi.mocked(completeWorkspaceDriver).mockRejectedValue(
        new WorkspaceAccountError("请核对档案", status)
      );
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        success: false,
        error: { message: "请核对档案" }
      });
    }
  );
  it("does not leak database credentials or SQL in unexpected failures", async () => {
    vi.mocked(completeWorkspaceDriver).mockRejectedValue(
      new Error("postgres://secret-db-password permission denied User")
    );
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-db-password");
  });
});

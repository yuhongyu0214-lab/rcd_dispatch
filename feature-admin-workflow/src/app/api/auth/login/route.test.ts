import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  findUserForLogin: vi.fn()
}));

vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  createSessionToken: vi.fn(() => "session-token"),
  getSessionCookieOptions: vi.fn(() => ({
    name: "dispatch_session",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 28_800
  }))
}));

vi.mock("@/app/api/driver/_utils", () => ({
  createDriverToken: vi.fn(() => "driver-token")
}));

import { createDriverToken } from "@/app/api/driver/_utils";
import { findUserForLogin } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";

import { POST } from "./route";

function loginRequest() {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Trace-Id": "trace-login"
    },
    body: JSON.stringify({
      account: "g3e2e-driver-01@invalid.example",
      password: "test-password"
    })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyPassword).mockResolvedValue(true);
});

describe("POST /api/auth/login", () => {
  it("returns the linked driver identity needed by the H5 redirect", async () => {
    vi.mocked(findUserForLogin).mockResolvedValue({
      id: "driver-user-1",
      email: "g3e2e-driver-01@invalid.example",
      name: "测试司机",
      password: "hash",
      role: "driver",
      driverId: "driver-1"
    });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: "driver-user-1",
      email: "g3e2e-driver-01@invalid.example",
      name: "测试司机",
      role: "driver",
      driverId: "driver-1",
      driverToken: "driver-token"
    });
    expect(createDriverToken).toHaveBeenCalledWith("driver-1");
    expect(response.headers.get("set-cookie")).toContain("dispatch_session=");
  });

  it("does not fabricate driver fields for a dispatcher", async () => {
    vi.mocked(findUserForLogin).mockResolvedValue({
      id: "dispatcher-1",
      email: "g3e2e-dispatcher@invalid.example",
      name: "测试调度员",
      password: "hash",
      role: "dispatcher",
      driverId: null
    });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("dispatcher");
    expect(body.data).not.toHaveProperty("driverId");
    expect(body.data).not.toHaveProperty("driverToken");
    expect(createDriverToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid password without returning identity data", async () => {
    vi.mocked(findUserForLogin).mockResolvedValue({
      id: "driver-user-1",
      email: "g3e2e-driver-01@invalid.example",
      name: "测试司机",
      password: "hash",
      role: "driver",
      driverId: "driver-1"
    });
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
  });
});

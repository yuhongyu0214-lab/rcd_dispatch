import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUTH_SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken
} from "@/lib/auth/session";

describe("auth session", () => {
  const originalSecret = process.env.AUTH_SESSION_SECRET;

  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET = "test-auth-secret";
  });

  afterEach(() => {
    if (originalSecret) {
      process.env.AUTH_SESSION_SECRET = originalSecret;
    } else {
      delete process.env.AUTH_SESSION_SECRET;
    }
  });

  it("创建的 session token 可以被成功校验", () => {
    const now = new Date("2026-05-24T00:00:00.000Z").getTime();
    const token = createSessionToken({
      userId: "user-1",
      role: "admin",
      now
    });

    expect(verifySessionToken(token, now)).toEqual({
      userId: "user-1",
      role: "admin",
      exp: Math.floor(now / 1000) + AUTH_SESSION_TTL_SECONDS
    });
  });

  it("被篡改的 token 会校验失败", () => {
    const token = createSessionToken({
      userId: "user-1",
      role: "admin",
      now: 0
    });
    const [payload, signature] = token.split(".");
    const tamperedToken = `${payload}.x${signature.slice(1)}`;

    expect(verifySessionToken(tamperedToken, 0)).toBeNull();
  });

  it("过期 token 会校验失败", () => {
    const now = new Date("2026-05-24T00:00:00.000Z").getTime();
    const token = createSessionToken({
      userId: "user-1",
      role: "admin",
      now
    });
    const expiredNow =
      now + (AUTH_SESSION_TTL_SECONDS + 1) * 1000;

    expect(verifySessionToken(token, expiredNow)).toBeNull();
  });
});

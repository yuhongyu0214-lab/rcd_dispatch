import crypto from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDriverToken, verifyDriverToken } from "./_utils";

describe("driver JWT", () => {
  beforeEach(() => {
    vi.stubEnv("DRIVER_JWT_SECRET", "test-driver-secret-with-enough-entropy");
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("verifies a valid token in development", () => {
    const token = createDriverToken("driver-1");

    expect(verifyDriverToken(token)?.sub).toBe("driver-1");
  });

  it("rejects a forged payload in development", () => {
    const token = createDriverToken("driver-1");
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: "attacker-driver",
        exp: Math.floor(Date.now() / 1000) + 3600
      })
    ).toString("base64url");

    expect(
      verifyDriverToken(`${header}.${forgedPayload}.${signature}`)
    ).toBeNull();
  });

  it("fails closed when DRIVER_JWT_SECRET is missing", () => {
    vi.stubEnv("DRIVER_JWT_SECRET", "");

    expect(() => createDriverToken("driver-1")).toThrow(
      "DRIVER_JWT_SECRET is not configured"
    );
    expect(verifyDriverToken("a.b.c")).toBeNull();
  });

  it("rejects a correctly signed token without exp", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "driver-1" })
    ).toString("base64url");
    const signature = crypto
      .createHmac("sha256", "test-driver-secret-with-enough-entropy")
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(verifyDriverToken(`${header}.${payload}.${signature}`)).toBeNull();
  });

  it("rejects a token whose exp equals the current second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T08:00:00.000Z"));
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "driver-1",
        exp: Math.floor(Date.now() / 1000)
      })
    ).toString("base64url");
    const signature = crypto
      .createHmac("sha256", "test-driver-secret-with-enough-entropy")
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(verifyDriverToken(`${header}.${payload}.${signature}`)).toBeNull();
  });
});

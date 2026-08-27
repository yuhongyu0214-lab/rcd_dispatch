import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { middleware } from "./middleware";

const BLOCKED_V1_WRITES = [
  "/api/assignments",
  "/api/assignments/reassign",
  "/api/assignments/accept",
  "/api/assignments/withdraw",
  "/api/dispatch/recommend",
  "/api/dispatch/confirm",
  "/api/driver/location",
  "/api/driver/tasks/assignment-1/accept",
  "/api/driver/tasks/assignment-1/complete",
  "/api/import/orders",
  "/api/ingest/order",
  "/api/ingest/browser-extension"
] as const;

function buildRequest(
  pathname: string,
  method = "POST",
  headers: Record<string, string> = {}
) {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers
  });
}

function expectPassedThrough(response: Response) {
  expect(response.status).not.toBe(410);
  expect(response.headers.get("x-middleware-next")).toBe("1");
}

describe("API middleware V1 write compatibility", () => {
  beforeEach(() => {
    delete process.env.RCD_V2_STATE_MACHINE_ENABLED;
    delete process.env.CORS_ORIGINS;
  });

  afterEach(() => {
    delete process.env.RCD_V2_STATE_MACHINE_ENABLED;
    delete process.env.CORS_ORIGINS;
  });

  it.each(BLOCKED_V1_WRITES)(
    "keeps %s unchanged before the V2 state-machine cutover",
    (pathname) => {
      expectPassedThrough(middleware(buildRequest(pathname)));

      process.env.RCD_V2_STATE_MACHINE_ENABLED = "false";
      expectPassedThrough(middleware(buildRequest(pathname)));
    }
  );

  it.each(BLOCKED_V1_WRITES)(
    "returns the V1 410 envelope for %s after cutover",
    async (pathname) => {
      process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";

      const response = middleware(buildRequest(pathname));
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({
        success: false,
        data: null,
        error: expect.stringContaining(pathname)
      });
      expect(typeof body.error).toBe("string");
      expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    }
  );

  it.each([
    ["GET", "/api/orders"],
    ["GET", "/api/orders/order-1"],
    ["GET", "/api/map"],
    ["GET", "/api/driver/tasks"],
    ["POST", "/api/driver/nav"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/register"],
    ["OPTIONS", "/api/ingest/browser-extension"],
    ["POST", "/api/v2/assignments"],
    ["POST", "/api/assignments/extra"],
    ["POST", "/api/driver/tasks/assignment-1/accept/extra"]
  ])("passes through %s %s after cutover", (method, pathname) => {
    process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";

    expectPassedThrough(middleware(buildRequest(pathname, method)));
  });

  it("preserves a valid incoming traceId in the 410 header and body", async () => {
    process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";

    const response = middleware(
      buildRequest("/api/assignments", "POST", {
        "X-Trace-Id": "trace-v1-write-cutover"
      })
    );
    const body = await response.json();

    expect(response.headers.get("X-Trace-Id")).toBe(
      "trace-v1-write-cutover"
    );
    expect(body.traceId).toBe("trace-v1-write-cutover");
  });

  it("generates one traceId for a 410 response when none is supplied", async () => {
    process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";

    const response = middleware(buildRequest("/api/assignments"));
    const body = await response.json();
    const responseTraceId = response.headers.get("X-Trace-Id");

    expect(responseTraceId).toBeTruthy();
    expect(body.traceId).toBe(responseTraceId);
  });

  it("keeps an allowed browser-extension 410 readable and leaves OPTIONS alone", async () => {
    process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";
    process.env.CORS_ORIGINS = "chrome-extension://allowed";

    const response = middleware(
      buildRequest("/api/ingest/browser-extension", "POST", {
        Origin: "chrome-extension://allowed"
      })
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "chrome-extension://allowed"
    );
    expect(response.headers.get("Vary")).toBe("Origin");

    expectPassedThrough(
      middleware(
        buildRequest("/api/ingest/browser-extension", "OPTIONS", {
          Origin: "chrome-extension://allowed"
        })
      )
    );
  });

  it("does not expose readable CORS headers to an unapproved origin", () => {
    process.env.RCD_V2_STATE_MACHINE_ENABLED = "true";
    process.env.CORS_ORIGINS = "chrome-extension://allowed";

    const response = middleware(
      buildRequest("/api/ingest/browser-extension", "POST", {
        Origin: "chrome-extension://blocked"
      })
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

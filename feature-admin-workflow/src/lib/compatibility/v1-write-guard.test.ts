import { describe, expect, it } from "vitest";

import {
  buildV1WriteGoneCorsHeaders,
  buildV1WriteGoneMessage,
  findV1WriteGuardMatch,
  isV2StateMachineEnabled
} from "./v1-write-guard";

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

describe("V1 write compatibility guard", () => {
  it("enables the cutover only for the exact true string", () => {
    expect(isV2StateMachineEnabled("true")).toBe(true);
    expect(isV2StateMachineEnabled("TRUE")).toBe(false);
    expect(isV2StateMachineEnabled(" true ")).toBe(false);
    expect(isV2StateMachineEnabled("false")).toBe(false);
    expect(isV2StateMachineEnabled(undefined)).toBe(false);
  });

  it.each(BLOCKED_V1_WRITES)("matches the frozen POST write %s", (pathname) => {
    const match = findV1WriteGuardMatch("POST", pathname);

    expect(match).not.toBeNull();
    expect(match?.pathname).toBe(pathname);
    expect(match?.guidance.length).toBeGreaterThan(0);
    expect(buildV1WriteGoneMessage(match!)).toContain(match?.guidance);
  });

  it.each(BLOCKED_V1_WRITES)("does not classify GET %s as a write", (pathname) => {
    expect(findV1WriteGuardMatch("GET", pathname)).toBeNull();
  });

  it.each([
    ["GET", "/api/orders"],
    ["GET", "/api/orders/order-1"],
    ["GET", "/api/orders/logs"],
    ["GET", "/api/map"],
    ["GET", "/api/map/eta"],
    ["GET", "/api/driver/tasks"],
    ["GET", "/api/import/orders/result"],
    ["GET", "/api/stores"],
    ["GET", "/api/health"],
    ["POST", "/api/driver/nav"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/register"],
    ["OPTIONS", "/api/ingest/browser-extension"],
    ["POST", "/api/v2/assignments"],
    ["PATCH", "/api/v2/orders/order-1"]
  ])("allows %s %s", (method, pathname) => {
    expect(findV1WriteGuardMatch(method, pathname)).toBeNull();
  });

  it.each([
    "/api/assignments/extra",
    "/api/assignments/reassign/extra",
    "/api/driver/tasks/accept",
    "/api/driver/tasks/assignment-1/accept/extra",
    "/api/driver/tasks/assignment-1/start",
    "/api/import/orders/result",
    "/api/ingest/order/extra",
    "/api/v20/assignments"
  ])("does not match a similar non-frozen POST path %s", (pathname) => {
    expect(findV1WriteGuardMatch("POST", pathname)).toBeNull();
  });

  it("adds readable CORS headers only for an allowed browser-extension origin", () => {
    const match = findV1WriteGuardMatch(
      "POST",
      "/api/ingest/browser-extension"
    );

    expect(match).not.toBeNull();
    expect(
      buildV1WriteGoneCorsHeaders(
        match!,
        "chrome-extension://allowed",
        "https://example.com, chrome-extension://allowed"
      )
    ).toMatchObject({
      "Access-Control-Allow-Origin": "chrome-extension://allowed",
      "Access-Control-Allow-Methods": "OPTIONS, POST",
      Vary: "Origin"
    });
    expect(
      buildV1WriteGoneCorsHeaders(
        match!,
        "chrome-extension://blocked",
        "chrome-extension://allowed"
      )
    ).toEqual({});
  });

  it("does not add browser-extension CORS headers to other V1 writes", () => {
    const match = findV1WriteGuardMatch("POST", "/api/assignments");

    expect(match).not.toBeNull();
    expect(
      buildV1WriteGoneCorsHeaders(
        match!,
        "chrome-extension://allowed",
        "chrome-extension://allowed"
      )
    ).toEqual({});
  });
});

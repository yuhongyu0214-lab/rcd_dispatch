import { describe, expect, it } from "vitest";

import {
  resolveLoginDestination,
  resolveSafeLoginPath
} from "./login-destination";

describe("resolveSafeLoginPath", () => {
  it.each([
    ["/driver/tasks", "/driver/tasks"],
    ["/admin", "/admin"],
    ["/admin/orders", "/admin/orders"],
    ["/admin/orders?status=pending", "/admin/orders?status=pending"]
  ])(
    "allows the supported internal destination %s",
    (requestedPath, expected) => {
      expect(resolveSafeLoginPath(requestedPath)).toBe(expected);
    }
  );

  it.each([
    "https://evil.example/admin/map",
    "//evil.example/admin/map",
    "/administrator",
    "/driver/tasks/another",
    "/",
    "javascript:alert(1)"
  ])("falls back for an unsupported destination %s", (requestedPath) => {
    expect(resolveSafeLoginPath(requestedPath)).toBe("/admin/map");
  });

  it("falls back when no destination was requested", () => {
    expect(resolveSafeLoginPath()).toBe("/admin/map");
  });
});

describe("resolveLoginDestination", () => {
  it("allows a historical driver account to enter the Web workspace", () => {
    expect(
      resolveLoginDestination(
        { role: "driver", driverId: "driver-g3e2e-01" },
        "/admin/map"
      )
    ).toBe("/admin/map");
  });

  it("sends a linked dispatcher to the driver H5 when it was requested", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "/driver/tasks"
      )
    ).toBe("/driver/tasks");
  });

  it("keeps a linked dispatcher in the admin when an admin page was requested", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "/admin/orders"
      )
    ).toBe("/admin/orders");
  });

  it("lets an unlinked dispatcher complete their profile inside H5", () => {
    expect(
      resolveLoginDestination({ role: "dispatcher" }, "/driver/tasks")
    ).toBe("/driver/tasks");
  });

  it("lets an unlinked historical driver complete their profile inside H5", () => {
    expect(resolveLoginDestination({ role: "driver" }, "/driver/tasks")).toBe(
      "/driver/tasks"
    );
  });

  it("sanitizes the requested destination before selecting it", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "//evil.example/admin/map"
      )
    ).toBe("/admin/map");
  });

  it.each(["system", "ingest", "unknown"])("does not grant interactive access to %s", (role) => {
    expect(resolveLoginDestination({ role }, "/driver/tasks")).toBe("/");
  });
});

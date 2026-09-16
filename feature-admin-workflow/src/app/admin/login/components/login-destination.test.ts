import { describe, expect, it } from "vitest";

import { resolveLoginDestination } from "./login-destination";

describe("resolveLoginDestination", () => {
  it("sends a linked historical driver account to the driver H5", () => {
    expect(
      resolveLoginDestination(
        { role: "driver", driverId: "driver-g3e2e-01" },
        "/admin/map"
      )
    ).toBe("/driver/tasks");
  });

  it("lets a linked dispatcher choose the driver H5 with a safe next", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "/driver/tasks"
      )
    ).toBe("/driver/tasks");
  });

  it("maps a linked dispatcher's legacy Web next to V2", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "/admin/orders"
      )
    ).toBe("/admin/orders/v2");
  });

  it("lets an unlinked dispatcher complete their profile inside H5", () => {
    expect(
      resolveLoginDestination({ role: "dispatcher" }, "/driver/tasks")
    ).toBe("/driver/tasks");
  });

  it("keeps an unlinked historical driver in H5 even when Web was requested", () => {
    expect(resolveLoginDestination({ role: "driver" }, "/admin/map")).toBe(
      "/driver/tasks"
    );
  });

  it.each(["admin", "dispatcher"])("sends %s to V2 by default", (role) => {
    expect(resolveLoginDestination({ role })).toBe("/admin/map/v2");
  });

  it("preserves a hidden compatibility tool for a dispatcher bookmark", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "/admin/orders?mode=logs"
      )
    ).toBe("/admin/orders?mode=logs");
  });

  it("sanitizes the requested destination before selecting it", () => {
    expect(
      resolveLoginDestination(
        { role: "dispatcher", driverId: "driver-g3e2e-01" },
        "//evil.example/admin/map"
      )
    ).toBe("/admin/map/v2");
  });

  it.each(["system", "ingest", "unknown"])("does not grant interactive access to %s", (role) => {
    expect(resolveLoginDestination({ role }, "/driver/tasks")).toBe("/");
  });
});

import { describe, expect, it } from "vitest";

import { resolveLoginDestination } from "./login-destination";

describe("resolveLoginDestination", () => {
  it("sends a linked driver account to the driver H5", () => {
    expect(
      resolveLoginDestination(
        { role: "driver", driverId: "driver-g3e2e-01" },
        "/admin/map"
      )
    ).toBe("/driver/tasks");
  });

  it("keeps the requested admin destination for dispatchers", () => {
    expect(
      resolveLoginDestination({ role: "dispatcher" }, "/admin/orders")
    ).toBe("/admin/orders");
  });

  it("does not treat an unbound driver role as an authenticated driver", () => {
    expect(resolveLoginDestination({ role: "driver" }, "/admin/map")).toBe(
      "/admin/map"
    );
  });
});

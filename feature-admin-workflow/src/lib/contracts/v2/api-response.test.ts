import { describe, expect, it } from "vitest";

import { createApiErrorV2 } from "./errors";
import { failV2, okV2 } from "./api-response";

describe("V2 API responses", () => {
  it("returns the frozen success envelope and matching trace header", async () => {
    const response = okV2({ status: "ok" }, { traceId: "trace-success-001" });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trace-Id")).toBe("trace-success-001");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "ok" },
      error: null,
      traceId: "trace-success-001"
    });
  });

  it("derives the failure status from the frozen error code", async () => {
    const error = createApiErrorV2("ILLEGAL_TRANSITION", "到达后禁止撤回", {
      currentStatus: "IN_SERVICE",
      targetStatus: "UNASSIGNED"
    });
    const response = failV2(error, { traceId: "trace-failure-001" });

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Trace-Id")).toBe("trace-failure-001");
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error,
      traceId: "trace-failure-001"
    });
  });
});

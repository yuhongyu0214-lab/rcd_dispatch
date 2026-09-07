import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v2/health", () => {
  it("returns only anonymous process liveness and the trace ID", async () => {
    const response = await GET(
      new Request("http://localhost/api/v2/health", {
        headers: { "X-Trace-Id": "trace-liveness" }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trace-Id")).toBe("trace-liveness");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "ok" },
      error: null,
      traceId: "trace-liveness"
    });
  });
});

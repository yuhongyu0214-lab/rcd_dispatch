import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("keeps the legacy probe process-only without dependency details", async () => {
    const response = await GET(
      new Request("http://localhost/api/health", {
        headers: { "X-Trace-Id": "trace-legacy-health" }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "ok" },
      error: null,
      traceId: "trace-legacy-health"
    });
  });
});

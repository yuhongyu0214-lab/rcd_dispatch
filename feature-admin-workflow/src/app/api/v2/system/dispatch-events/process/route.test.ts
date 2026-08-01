import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events", () => ({
  enqueueCurrentBaselineRecalculation: vi.fn(),
  processPendingInternalEvents: vi.fn()
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import {
  enqueueCurrentBaselineRecalculation,
  processPendingInternalEvents
} from "@/lib/events";

import { POST } from "./route";

describe("POST /api/v2/system/dispatch-events/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INTERNAL_CRON_SECRET", "worker-secret");
    vi.mocked(enqueueCurrentBaselineRecalculation).mockResolvedValue({
      eventId: "baseline-recalculation:2026-07-26T06:00:00.000Z",
      committed: true
    });
  });

  it("drains pending events with an authenticated request", async () => {
    vi.mocked(processPendingInternalEvents).mockResolvedValue({
      processed: 4,
      failed: 1
    });

    const response = await POST(
      new Request(
        "http://localhost/api/v2/system/dispatch-events/process?limit=25",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer worker-secret",
            "X-Trace-Id": "trace-worker"
          }
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trace-Id")).toBe("trace-worker");
    expect(enqueueCurrentBaselineRecalculation).toHaveBeenCalledWith(
      "trace-worker"
    );
    expect(processPendingInternalEvents).toHaveBeenCalledWith(25);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { processed: 4, failed: 1 },
      traceId: "trace-worker"
    });
  });

  it("rejects an invalid credential", async () => {
    const response = await POST(
      new Request("http://localhost/api/v2/system/dispatch-events/process", {
        method: "POST",
        headers: { "X-Internal-Key": "wrong" }
      })
    );

    expect(response.status).toBe(401);
    expect(enqueueCurrentBaselineRecalculation).not.toHaveBeenCalled();
    expect(processPendingInternalEvents).not.toHaveBeenCalled();
  });

  it("fails closed when the worker secret is missing", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "");

    const response = await POST(
      new Request("http://localhost/api/v2/system/dispatch-events/process", {
        method: "POST"
      })
    );

    expect(response.status).toBe(500);
    expect(enqueueCurrentBaselineRecalculation).not.toHaveBeenCalled();
    expect(processPendingInternalEvents).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range batch limit", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/v2/system/dispatch-events/process?limit=101",
        {
          method: "POST",
          headers: { "X-Internal-Key": "worker-secret" }
        }
      )
    );

    expect(response.status).toBe(400);
    expect(enqueueCurrentBaselineRecalculation).not.toHaveBeenCalled();
    expect(processPendingInternalEvents).not.toHaveBeenCalled();
  });
});

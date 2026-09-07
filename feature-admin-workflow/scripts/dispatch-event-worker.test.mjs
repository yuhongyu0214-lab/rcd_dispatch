import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDispatchWorkerConfig,
  DEFAULT_WORKER_HEARTBEAT_PATH,
  isDispatchWorkerHeartbeatFresh,
  runDispatchEventWorkerOnce,
  startDispatchEventWorker,
  writeDispatchWorkerHeartbeat
} from "./dispatch-event-worker.mjs";

afterEach(() => {
  delete process.env.DISPATCH_EVENT_WORKER_HEARTBEAT_PATH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("dispatch event production worker", () => {
  it("writes a private timestamp heartbeat to the worker-only path", async () => {
    const writeFileImpl = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-08-06T15:00:00.000Z");

    await writeDispatchWorkerHeartbeat({ now, writeFileImpl });

    expect(writeFileImpl).toHaveBeenCalledWith(
      DEFAULT_WORKER_HEARTBEAT_PATH,
      "2026-08-06T15:00:00.000Z",
      { encoding: "utf8", mode: 0o600 }
    );
  });

  it("uses the heartbeat path configured for the worker container", async () => {
    process.env.DISPATCH_EVENT_WORKER_HEARTBEAT_PATH =
      "/tmp/configured-worker-heartbeat";
    const writeFileImpl = vi.fn().mockResolvedValue(undefined);

    await writeDispatchWorkerHeartbeat({ writeFileImpl });

    expect(writeFileImpl).toHaveBeenCalledWith(
      "/tmp/configured-worker-heartbeat",
      expect.any(String),
      { encoding: "utf8", mode: 0o600 }
    );
  });

  it("accepts only a present, non-future heartbeat within 150 seconds", async () => {
    const nowMs = Date.parse("2026-08-06T15:03:00.000Z");

    await expect(
      isDispatchWorkerHeartbeatFresh({
        nowMs,
        statImpl: vi.fn().mockResolvedValue({ mtimeMs: nowMs - 150_000 })
      })
    ).resolves.toBe(true);
    await expect(
      isDispatchWorkerHeartbeatFresh({
        nowMs,
        statImpl: vi.fn().mockResolvedValue({ mtimeMs: nowMs - 150_001 })
      })
    ).resolves.toBe(false);
    await expect(
      isDispatchWorkerHeartbeatFresh({
        nowMs,
        statImpl: vi.fn().mockResolvedValue({ mtimeMs: nowMs + 1 })
      })
    ).resolves.toBe(false);
    await expect(
      isDispatchWorkerHeartbeatFresh({
        nowMs,
        statImpl: vi.fn().mockRejectedValue(new Error("missing"))
      })
    ).resolves.toBe(false);
  });

  it("requires a target origin and an independent secret", () => {
    expect(() =>
      createDispatchWorkerConfig({ INTERNAL_CRON_SECRET: "secret" })
    ).toThrow("DISPATCH_EVENT_WORKER_ORIGIN");
    expect(() =>
      createDispatchWorkerConfig({
        DISPATCH_EVENT_WORKER_ORIGIN: "https://dispatch.example.com"
      })
    ).toThrow("INTERNAL_CRON_SECRET");
    expect(() =>
      createDispatchWorkerConfig({
        DISPATCH_EVENT_WORKER_ORIGIN:
          "https://dispatch.example.com/not-an-origin",
        INTERNAL_CRON_SECRET: "secret"
      })
    ).toThrow("safe HTTP origin");
  });

  it("posts once with the secret only in the Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { processed: 2, failed: 0 },
          error: null,
          traceId: "server-trace"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": "server-trace"
          }
        }
      )
    );

    await expect(
      runDispatchEventWorkerOnce({
        config: createDispatchWorkerConfig({
          DISPATCH_EVENT_WORKER_ORIGIN: "https://dispatch.example.com",
          INTERNAL_CRON_SECRET: "worker-secret"
        }),
        fetchImpl,
        traceId: "worker-trace"
      })
    ).resolves.toEqual({
      processed: 2,
      failed: 0,
      traceId: "server-trace"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://dispatch.example.com/api/v2/system/dispatch-events/process?limit=20"
    );
    expect(String(url)).not.toContain("worker-secret");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer worker-secret",
        "X-Trace-Id": "worker-trace"
      }
    });
  });

  it("rejects successful HTTP responses that do not use the V2 success envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: { code: "INTERNAL_ERROR", message: "failed" },
          traceId: "server-trace"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(
      runDispatchEventWorkerOnce({
        config: createDispatchWorkerConfig({
          DISPATCH_EVENT_WORKER_ORIGIN: "https://dispatch.example.com",
          INTERNAL_CRON_SECRET: "worker-secret"
        }),
        fetchImpl,
        traceId: "worker-trace"
      })
    ).rejects.toThrow("WORKER_RESPONSE_FAILED");
  });

  it("runs immediately and starts the next request after sixty seconds", async () => {
    vi.useFakeTimers();
    const stopController = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { processed: 0, failed: 0 },
            error: null,
            traceId: "server-trace"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const heartbeat = vi.fn().mockResolvedValue(undefined);

    const worker = startDispatchEventWorker({
      config: createDispatchWorkerConfig({
        DISPATCH_EVENT_WORKER_ORIGIN: "https://dispatch.example.com",
        INTERNAL_CRON_SECRET: "worker-secret"
      }),
      fetchImpl,
      heartbeat,
      logger,
      signal: stopController.signal
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    stopController.abort();
    await vi.advanceTimersByTimeAsync(0);
    await worker;
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not refresh the heartbeat when an event cycle reports failures", async () => {
    vi.useFakeTimers();
    const stopController = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { processed: 0, failed: 1 },
          error: null,
          traceId: "server-trace"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const worker = startDispatchEventWorker({
      config: createDispatchWorkerConfig({
        DISPATCH_EVENT_WORKER_ORIGIN: "https://dispatch.example.com",
        INTERNAL_CRON_SECRET: "worker-secret"
      }),
      fetchImpl,
      heartbeat,
      logger,
      signal: stopController.signal
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 0, failed: 1 }),
      "dispatch_event_worker_completed_with_failures"
    );

    stopController.abort();
    await vi.advanceTimersByTimeAsync(0);
    await worker;
  });
});

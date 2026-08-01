import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import pino from "pino";

const WORKER_INTERVAL_MS = 60_000;
const WORKER_REQUEST_TIMEOUT_MS = 30_000;

export function createDispatchWorkerConfig(environment) {
  const origin = environment.DISPATCH_EVENT_WORKER_ORIGIN?.trim();
  if (!origin) {
    throw new Error("DISPATCH_EVENT_WORKER_ORIGIN is required");
  }

  const secret = environment.INTERNAL_CRON_SECRET?.trim();
  if (!secret) {
    throw new Error("INTERNAL_CRON_SECRET is required");
  }

  const parsedOrigin = new URL(origin);
  if (
    !["http:", "https:"].includes(parsedOrigin.protocol) ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error("DISPATCH_EVENT_WORKER_ORIGIN must be a safe HTTP origin");
  }

  const endpoint = new URL(
    "/api/v2/system/dispatch-events/process?limit=20",
    parsedOrigin.origin
  );
  return { endpoint, secret };
}

export async function runDispatchEventWorkerOnce({
  config,
  fetchImpl = globalThis.fetch,
  signal,
  traceId = randomUUID()
}) {
  const abortController = new AbortController();
  const abortOnStop = () => abortController.abort();
  signal?.addEventListener("abort", abortOnStop, { once: true });
  const timeout = setTimeout(
    () => abortController.abort(),
    WORKER_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "X-Trace-Id": traceId
      },
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new Error(`WORKER_HTTP_${response.status}`);
    }

    const payload = await response.json();
    if (
      payload?.success !== true ||
      !Number.isInteger(payload?.data?.processed) ||
      !Number.isInteger(payload?.data?.failed)
    ) {
      throw new Error("WORKER_RESPONSE_FAILED");
    }

    return {
      processed: payload.data.processed,
      failed: payload.data.failed,
      traceId:
        response.headers.get("X-Trace-Id") ??
        payload.traceId ??
        traceId
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortOnStop);
  }
}

function waitForNextRun(delayMs, signal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startDispatchEventWorker({
  config,
  fetchImpl = globalThis.fetch,
  logger,
  signal
}) {
  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      const result = await runDispatchEventWorkerOnce({
        config,
        fetchImpl,
        signal
      });
      const logData = {
        traceId: result.traceId,
        processed: result.processed,
        failed: result.failed,
        elapsedMs: Date.now() - startedAt
      };
      if (result.failed > 0) {
        logger.warn(logData, "dispatch_event_worker_completed_with_failures");
      } else {
        logger.info(logData, "dispatch_event_worker_succeeded");
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt
        },
        "dispatch_event_worker_failed"
      );
    }

    const elapsedMs = Date.now() - startedAt;
    await waitForNextRun(
      Math.max(0, WORKER_INTERVAL_MS - elapsedMs),
      signal
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const logger = pino({
    name: "dispatch-event-worker",
    level: process.env.LOG_LEVEL ?? "info"
  });
  const stopController = new AbortController();
  process.once("SIGINT", () => stopController.abort());
  process.once("SIGTERM", () => stopController.abort());

  try {
    const config = createDispatchWorkerConfig(process.env);
    await startDispatchEventWorker({
      config,
      logger,
      signal: stopController.signal
    });
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      "dispatch_event_worker_start_failed"
    );
    process.exitCode = 1;
  }
}

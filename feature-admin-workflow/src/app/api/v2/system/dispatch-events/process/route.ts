import { timingSafeEqual } from "node:crypto";

import { failV2, okV2 } from "@/lib/contracts/v2";
import { createApiErrorV2 } from "@/lib/contracts/v2/errors";
import {
  enqueueCurrentBaselineRecalculation,
  processPendingInternalEvents
} from "@/lib/events";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("dispatch-event-worker-api");

function matchesSecret(presented: string, configured: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const configuredBuffer = Buffer.from(configured);
  return (
    presentedBuffer.length === configuredBuffer.length &&
    timingSafeEqual(presentedBuffer, configuredBuffer)
  );
}

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const configuredSecret = process.env.INTERNAL_CRON_SECRET;
  if (!configuredSecret) {
    log.error("INTERNAL_CRON_SECRET is not configured", { traceId });
    return failV2(
      createApiErrorV2(
        "INTERNAL_ERROR",
        "Dispatch event worker is not configured"
      ),
      { traceId }
    );
  }

  const presentedSecret =
    request.headers.get("X-Internal-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!matchesSecret(presentedSecret, configuredSecret)) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Invalid internal worker credential"),
      { traceId }
    );
  }

  const requestedLimit = Number(
    new URL(request.url).searchParams.get("limit") ?? "20"
  );
  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 100
  ) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "limit must be an integer between 1 and 100",
        { fields: { limit: ["Expected an integer between 1 and 100"] } }
      ),
      { traceId }
    );
  }

  try {
    await enqueueCurrentBaselineRecalculation(traceId);
    const result = await processPendingInternalEvents(requestedLimit);
    return okV2(result, { traceId });
  } catch (error) {
    log.error("Dispatch event worker failed", {
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Dispatch event worker failed"),
      { traceId }
    );
  }
}

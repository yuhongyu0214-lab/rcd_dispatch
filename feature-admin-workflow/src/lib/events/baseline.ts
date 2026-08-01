import type { InternalEventResult } from "./types";

import { prisma } from "@/lib/prisma";

import { enqueueInternalEvent } from "./store";

export const BASELINE_INTERVAL_MS = 10 * 60 * 1000;

function baselineBucketStart(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / BASELINE_INTERVAL_MS) * BASELINE_INTERVAL_MS
  );
}

/**
 * Ensure the current ten-minute baseline event exists.
 *
 * The worker may run every minute. A UTC bucket-derived eventId makes all
 * invocations within one ten-minute window idempotent while still producing
 * the next global recalculation as soon as a new window starts.
 */
export async function enqueueCurrentBaselineRecalculation(
  traceId: string,
  now = new Date()
): Promise<InternalEventResult> {
  const occurredAt = baselineBucketStart(now).toISOString();
  const eventId = `baseline-recalculation:${occurredAt}`;

  return prisma.$transaction((tx) =>
    enqueueInternalEvent(tx, {
      eventId,
      type: "BASELINE_RECALCULATION",
      occurredAt,
      traceId
    })
  );
}

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import type { InternalEvent, InternalEventResult } from "./types";

const eventLog = createLogger("internal-events");

/**
 * Commit an internal event to the idempotency store.
 *
 * Uses the OrderSourceEvent model with:
 *   sourceSystem = "INTERNAL"
 *   externalOrderId = eventId (stable, caller-provided)
 *   sourceVersion = "1" (fixed — business occurrence time goes to receivedAt)
 *
 * The `@@unique([sourceSystem, externalOrderId, sourceVersion])` constraint
 * with sourceVersion fixed at "1" means the stable eventId alone gates
 * idempotency. Retries with the same eventId always hit the unique constraint
 * regardless of when they arrive.
 *
 * MUST be called AFTER the business transaction commit succeeds (i.e., never
 * inside a transaction that could be rolled back on trigger failure).
 */
export async function commitInternalEvent(
  event: InternalEvent
): Promise<InternalEventResult> {
  try {
    await prisma.orderSourceEvent.create({
      data: {
        sourceSystem: "INTERNAL",
        externalOrderId: event.eventId,
        sourceVersion: "1",
        sourceStatusRaw: event.type,
        result: "SUCCESS",
        traceId: event.traceId,
        orderId: event.orderId ?? null,
        payloadSummary: {
          type: event.type,
          driverId: event.driverId ?? null,
        },
        receivedAt: new Date(event.occurredAt),
        processedAt: new Date(),
      },
    });
    eventLog.info("internal_event_committed", {
      eventId: event.eventId,
      type: event.type,
      orderId: event.orderId,
      traceId: event.traceId,
    });
    return { eventId: event.eventId, committed: true };
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      eventLog.info("internal_event_duplicate_skipped", {
        eventId: event.eventId,
        type: event.type,
      });
      return {
        eventId: event.eventId,
        committed: false,
        reason: "DUPLICATE",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    eventLog.error("internal_event_commit_failed", {
      eventId: event.eventId,
      type: event.type,
      error: message,
    });
    return { eventId: event.eventId, committed: false };
  }
}

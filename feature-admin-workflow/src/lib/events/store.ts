import type { Prisma } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import type { InternalEvent, InternalEventResult } from "./types";

const eventLog = createLogger("internal-events");

/**
 * Enqueue an internal event in the dedicated dispatch outbox.
 *
 * This function must receive the SAME transaction client that writes the
 * originating business fact. An unexpected outbox write error is rethrown so
 * the business transaction rolls back instead of committing an untriggerable
 * state change.
 */
export async function enqueueInternalEvent(
  tx: Prisma.TransactionClient,
  event: InternalEvent
): Promise<InternalEventResult> {
  try {
    const result = await tx.dispatchEventOutbox.createMany({
      data: [{
        eventId: event.eventId,
        type: event.type,
        orderId: event.orderId ?? null,
        driverId: event.driverId ?? null,
        assignmentId: event.assignmentId ?? null,
        occurredAt: new Date(event.occurredAt),
        traceId: event.traceId
      }],
      skipDuplicates: true
    });
    if (result.count === 0) {
      eventLog.info("internal_event_duplicate_skipped", {
        eventId: event.eventId,
        type: event.type
      });
      return {
        eventId: event.eventId,
        committed: false,
        reason: "DUPLICATE"
      };
    }
    eventLog.info("internal_event_enqueued", {
      eventId: event.eventId,
      type: event.type,
      orderId: event.orderId,
      traceId: event.traceId
    });
    return { eventId: event.eventId, committed: true };
  } catch (err: unknown) {
    eventLog.error("internal_event_enqueue_failed", {
      eventId: event.eventId,
      type: event.type,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}

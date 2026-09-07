import { randomUUID } from "crypto";

import type { DispatchEventOutbox } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { handleInternalEvent } from "./dispatch-trigger";
import type { InternalEvent, WhitelistedEventType } from "./types";

const log = createLogger("internal-event-processor");
const CLAIM_LEASE_MS = 60_000;

function toInternalEvent(row: DispatchEventOutbox): InternalEvent {
  return {
    eventId: row.eventId,
    type: row.type as WhitelistedEventType,
    orderId: row.orderId ?? undefined,
    driverId: row.driverId ?? undefined,
    assignmentId: row.assignmentId ?? undefined,
    occurredAt: row.occurredAt.toISOString(),
    traceId: row.traceId
  };
}

export async function processInternalEvent(
  eventId: string
): Promise<"processed" | "skipped"> {
  const now = new Date();
  const lockToken = randomUUID();
  const staleLock = new Date(now.getTime() - CLAIM_LEASE_MS);
  const claim = await prisma.dispatchEventOutbox.updateMany({
    where: {
      eventId,
      processedAt: null,
      availableAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }]
    },
    data: {
      lockedAt: now,
      lockToken,
      attempts: { increment: 1 }
    }
  });
  if (claim.count !== 1) return "skipped";

  const row = await prisma.dispatchEventOutbox.findUnique({
    where: { eventId }
  });
  if (!row || row.lockToken !== lockToken) return "skipped";

  try {
    await handleInternalEvent(toInternalEvent(row));
    const completion = await prisma.dispatchEventOutbox.updateMany({
      where: { id: row.id, lockToken, processedAt: null },
      data: {
        processedAt: new Date(),
        lockedAt: null,
        lockToken: null,
        lastError: null
      }
    });
    return completion.count === 1 ? "processed" : "skipped";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const backoffSeconds = Math.min(300, 2 ** Math.min(row.attempts, 8));
    await prisma.dispatchEventOutbox.updateMany({
      where: { id: row.id, lockToken, processedAt: null },
      data: {
        availableAt: new Date(Date.now() + backoffSeconds * 1000),
        lockedAt: null,
        lockToken: null,
        lastError: message.slice(0, 2000)
      }
    });
    log.error("internal_event_processing_failed", {
      eventId,
      type: row.type,
      attempts: row.attempts,
      error: message
    });
    throw error;
  }
}

export async function processPendingInternalEvents(
  limit = 20
): Promise<{ processed: number; failed: number }> {
  const rows = await prisma.dispatchEventOutbox.findMany({
    where: {
      processedAt: null,
      availableAt: { lte: new Date() }
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { eventId: true }
  });

  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if ((await processInternalEvent(row.eventId)) === "processed") {
        processed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { processed, failed };
}

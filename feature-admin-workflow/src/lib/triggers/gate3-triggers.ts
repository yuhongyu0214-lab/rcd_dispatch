import type { InternalEvent } from "@/lib/events/types";
import { commitInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";

const triggerLog = createLogger("gate3-triggers");

function makeEventId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Thin trigger functions — Gate 3 frozen assignment lifecycle
//
// Frozen constraints (2026-07-19 ruling):
//   - No dispatch queries, plan calculations, or transaction commit logic
//   - Called AFTER business transaction commit succeeds
//   - Trigger failure does NOT rollback committed business facts
// ---------------------------------------------------------------------------

export async function triggerAssignmentAssigned(params: {
  orderId: string;
  driverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: makeEventId("assign"),
    type: "ASSIGNMENT_ASSIGNED",
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_ASSIGNED failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentReassigned(params: {
  orderId: string;
  toDriverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: makeEventId("reassign"),
    type: "ASSIGNMENT_REASSIGNED",
    orderId: params.orderId,
    driverId: params.toDriverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_REASSIGNED failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentWithdrawn(params: {
  orderId: string;
  driverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: makeEventId("withdraw"),
    type: "ASSIGNMENT_WITHDRAWN",
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_WITHDRAWN failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentCancelled(params: {
  orderId: string;
  driverId?: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: makeEventId("cancel"),
    type: "ASSIGNMENT_CANCELLED",
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_CANCELLED failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

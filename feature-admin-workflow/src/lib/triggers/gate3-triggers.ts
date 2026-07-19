import type { InternalEvent } from "@/lib/events/types";
import { commitInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";

const triggerLog = createLogger("gate3-triggers");

// ---------------------------------------------------------------------------
// Thin trigger functions — Gate 3 frozen assignment lifecycle
//
// Frozen constraints (2026-07-19 ruling):
//   - No dispatch queries, plan calculations, or transaction commit logic
//   - Called AFTER business transaction commit succeeds
//   - Trigger failure does NOT rollback committed business facts
//   - eventId must be a stable identifier derived from the business operation
//     (e.g., `assign-{assignmentId}`), NOT a random UUID. The caller is
//     responsible for producing the same eventId on retry of the same fact.
// ---------------------------------------------------------------------------

export async function triggerAssignmentAssigned(params: {
  eventId: string;
  assignmentId: string;
  orderId: string;
  driverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: params.eventId,
    type: "ASSIGNMENT_ASSIGNED",
    assignmentId: params.assignmentId,
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_ASSIGNED failed", {
      eventId: params.eventId,
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentReassigned(params: {
  eventId: string;
  assignmentId: string;
  orderId: string;
  toDriverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: params.eventId,
    type: "ASSIGNMENT_REASSIGNED",
    assignmentId: params.assignmentId,
    orderId: params.orderId,
    driverId: params.toDriverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_REASSIGNED failed", {
      eventId: params.eventId,
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentWithdrawn(params: {
  eventId: string;
  assignmentId: string;
  orderId: string;
  driverId: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: params.eventId,
    type: "ASSIGNMENT_WITHDRAWN",
    assignmentId: params.assignmentId,
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_WITHDRAWN failed", {
      eventId: params.eventId,
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

export async function triggerAssignmentCancelled(params: {
  eventId: string;
  assignmentId: string;
  orderId: string;
  driverId?: string;
  occurredAt: string;
  traceId: string;
}): Promise<void> {
  const event: InternalEvent = {
    eventId: params.eventId,
    type: "ASSIGNMENT_CANCELLED",
    assignmentId: params.assignmentId,
    orderId: params.orderId,
    driverId: params.driverId,
    occurredAt: params.occurredAt,
    traceId: params.traceId,
  };
  await commitInternalEvent(event).catch((err) => {
    triggerLog.error("trigger ASSIGNMENT_CANCELLED failed", {
      eventId: params.eventId,
      orderId: params.orderId,
      traceId: params.traceId,
      error: String(err),
    });
  });
}

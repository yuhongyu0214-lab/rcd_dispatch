import type { Prisma } from "@prisma/client";

import type { InternalEvent } from "@/lib/events/types";
import { enqueueInternalEvent } from "@/lib/events/store";

// ---------------------------------------------------------------------------
// Thin trigger functions — Gate 3 frozen assignment lifecycle
//
// Frozen constraints (2026-07-19 ruling):
//   - No dispatch queries, plan calculations, or transaction commit logic
//   - Called INSIDE the same transaction as the business fact
//   - Outbox failure rolls the transaction back; processing failure does not
//   - eventId must be a stable identifier derived from the business operation
//     (e.g., `assign-{assignmentId}`), NOT a random UUID. The caller is
//     responsible for producing the same eventId on retry of the same fact.
// ---------------------------------------------------------------------------

export async function triggerAssignmentAssigned(params: {
  tx: Prisma.TransactionClient;
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
    traceId: params.traceId
  };
  await enqueueInternalEvent(params.tx, event);
}

export async function triggerAssignmentReassigned(params: {
  tx: Prisma.TransactionClient;
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
    traceId: params.traceId
  };
  await enqueueInternalEvent(params.tx, event);
}

export async function triggerAssignmentWithdrawn(params: {
  tx: Prisma.TransactionClient;
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
    traceId: params.traceId
  };
  await enqueueInternalEvent(params.tx, event);
}

export async function triggerAssignmentCancelled(params: {
  tx: Prisma.TransactionClient;
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
    traceId: params.traceId
  };
  await enqueueInternalEvent(params.tx, event);
}

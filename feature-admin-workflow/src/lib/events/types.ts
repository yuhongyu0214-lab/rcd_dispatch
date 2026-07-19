import type { IsoDateTimeStringV2 } from "@/types/v2";

// ---------------------------------------------------------------------------
// Internal Event — frozen per 2026-07-19 Gate 3 ruling
// ---------------------------------------------------------------------------

/**
 * Whitelisted internal event types.
 *
 * Gate 3-0 frozen set (2026-07-19):
 *   1A: ORDER_CREATED, ORDER_UPDATED, ORDER_CANCELLED
 *   1B: DRIVER_LOCATION_UPDATED, DRIVER_SHIFT_STARTED, DRIVER_SHIFT_ENDED
 *   Gate 3: ASSIGNMENT_ASSIGNED, ASSIGNMENT_REASSIGNED,
 *            ASSIGNMENT_WITHDRAWN, ASSIGNMENT_CANCELLED
 *   2B execution: DEPART, ARRIVE, COMPLETE, MODULE_CHANGE_APPLIED
 */
export const WHITELISTED_EVENT_TYPES = [
  // 1A: order lifecycle
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  // 1B: location & shift state changes
  "DRIVER_LOCATION_UPDATED",
  "DRIVER_SHIFT_STARTED",
  "DRIVER_SHIFT_ENDED",
  // Gate 3 frozen: assignment lifecycle
  "ASSIGNMENT_ASSIGNED",
  "ASSIGNMENT_REASSIGNED",
  "ASSIGNMENT_WITHDRAWN",
  "ASSIGNMENT_CANCELLED",
  // 2B: execution lifecycle
  "DEPART",
  "ARRIVE",
  "COMPLETE",
  "MODULE_CHANGE_APPLIED",
] as const;

export type WhitelistedEventType = (typeof WHITELISTED_EVENT_TYPES)[number];

/**
 * Frozen internal event structure.
 *
 * - eventId: unique identifier for idempotency
 * - type:    one of the whitelisted event types
 * - orderId / driverId / assignmentId: optional subject references
 * - occurredAt: when the business fact occurred
 * - traceId: correlation ID for the originating request
 */
export type InternalEvent = {
  eventId: string;
  type: WhitelistedEventType;
  orderId?: string;
  driverId?: string;
  assignmentId?: string;
  occurredAt: IsoDateTimeStringV2;
  traceId: string;
};

/** Result of committing an internal event. */
export type InternalEventResult = {
  eventId: string;
  committed: boolean;
  reason?: "DUPLICATE" | "STALE_VERSION" | "NO_STATE_CHANGE";
};

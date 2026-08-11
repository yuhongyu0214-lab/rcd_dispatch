import type { InternalEvent } from "./types";
import type { DispatchEventV2 } from "@/types/v2";

import { runDispatchApplication } from "@/lib/dispatch-v2/application/dispatch-orchestrator";

const EVENT_TYPE_MAP: Record<InternalEvent["type"], DispatchEventV2["type"]> = {
  ORDER_CREATED: "ORDER_RECEIVED",
  ORDER_UPDATED: "ORDER_MODIFIED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  DRIVER_LOCATION_UPDATED: "DRIVER_LOCATION_CHANGED",
  DRIVER_SHIFT_STARTED: "DRIVER_SHIFT_CHANGED",
  DRIVER_SHIFT_ENDED: "DRIVER_SHIFT_CHANGED",
  ASSIGNMENT_ASSIGNED: "ASSIGNMENT_EXECUTION_CHANGED",
  ASSIGNMENT_REASSIGNED: "ASSIGNMENT_EXECUTION_CHANGED",
  ASSIGNMENT_WITHDRAWN: "ASSIGNMENT_EXECUTION_CHANGED",
  ASSIGNMENT_CANCELLED: "ASSIGNMENT_EXECUTION_CHANGED",
  BASELINE_RECALCULATION: "BASELINE_RECALCULATION",
  DEPART: "ASSIGNMENT_EXECUTION_CHANGED",
  ARRIVE: "ASSIGNMENT_EXECUTION_CHANGED",
  COMPLETE: "ASSIGNMENT_EXECUTION_CHANGED",
  MODULE_CHANGE_APPLIED: "SERVICE_MODULES_CHANGED"
};

/**
 * Process an internal event and determine if it warrants a dispatch run.
 *
 * The outbox processor calls this only for committed, non-duplicate business
 * facts. Snapshot construction and ETA resolution happen outside the write
 * transaction; the committer rechecks planVersion under row locks.
 */
export async function handleInternalEvent(
  event: InternalEvent
): Promise<{ shouldTriggerDispatch: boolean; reason?: string }> {
  const dispatchEvent: DispatchEventV2 = {
    type: EVENT_TYPE_MAP[event.type],
    occurredAt: event.occurredAt,
    orderId: event.orderId,
    driverId: event.driverId,
    assignmentId: event.assignmentId
  };
  await runDispatchApplication(dispatchEvent, event.traceId);
  return {
    shouldTriggerDispatch: true
  };
}

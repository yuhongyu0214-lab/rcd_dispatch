import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/events/store", () => ({
  enqueueInternalEvent: vi.fn()
}));

import { enqueueInternalEvent } from "@/lib/events/store";

import {
  triggerAssignmentAssigned,
  triggerAssignmentCancelled,
  triggerAssignmentReassigned,
  triggerAssignmentWithdrawn
} from "./gate3-triggers";

const tx = {} as never;
const base = {
  tx,
  assignmentId: "assignment-1",
  orderId: "order-1",
  occurredAt: "2026-07-26T06:00:00.000Z",
  traceId: "trace-1"
};

describe("Gate 3 assignment event producers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues ASSIGNMENT_ASSIGNED on the caller transaction", async () => {
    await triggerAssignmentAssigned({
      ...base,
      eventId: "assignment-assigned:assignment-1",
      driverId: "driver-1"
    });

    expect(enqueueInternalEvent).toHaveBeenCalledWith(tx, {
      eventId: "assignment-assigned:assignment-1",
      type: "ASSIGNMENT_ASSIGNED",
      assignmentId: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      occurredAt: base.occurredAt,
      traceId: "trace-1"
    });
  });

  it("maps reassignment to the destination driver", async () => {
    await triggerAssignmentReassigned({
      ...base,
      eventId: "assignment-reassigned:assignment-1",
      toDriverId: "driver-2"
    });

    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "ASSIGNMENT_REASSIGNED",
        driverId: "driver-2"
      })
    );
  });

  it("enqueues withdrawal and cancellation without processing after commit", async () => {
    await triggerAssignmentWithdrawn({
      ...base,
      eventId: "assignment-withdrawn:assignment-1",
      driverId: "driver-1"
    });
    await triggerAssignmentCancelled({
      ...base,
      eventId: "assignment-cancelled:assignment-1",
      driverId: "driver-1"
    });

    expect(vi.mocked(enqueueInternalEvent).mock.calls[0][1]).toMatchObject({
      type: "ASSIGNMENT_WITHDRAWN"
    });
    expect(vi.mocked(enqueueInternalEvent).mock.calls[1][1]).toMatchObject({
      type: "ASSIGNMENT_CANCELLED"
    });
  });
});

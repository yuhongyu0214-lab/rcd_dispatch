import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dispatch-v2/application/dispatch-orchestrator", () => ({
  runDispatchApplication: vi.fn()
}));

import { runDispatchApplication } from "@/lib/dispatch-v2/application/dispatch-orchestrator";

import { handleInternalEvent } from "./dispatch-trigger";

describe("handleInternalEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runDispatchApplication).mockResolvedValue({
      changedDriverIds: [],
      releasedAssignments: 0,
      createdAssignments: 0
    });
  });

  it("maps a durable order event into the real dispatch application", async () => {
    await expect(
      handleInternalEvent({
        eventId: "event-1",
        type: "ORDER_UPDATED",
        orderId: "order-1",
        occurredAt: "2026-07-26T06:00:00.000Z",
        traceId: "trace-1"
      })
    ).resolves.toEqual({ shouldTriggerDispatch: true });

    expect(runDispatchApplication).toHaveBeenCalledWith(
      {
        type: "ORDER_MODIFIED",
        occurredAt: "2026-07-26T06:00:00.000Z",
        orderId: "order-1",
        driverId: undefined,
        assignmentId: undefined
      },
      "trace-1"
    );
  });

  it("propagates dispatch failures so the outbox event remains retryable", async () => {
    vi.mocked(runDispatchApplication).mockRejectedValue(
      new Error("snapshot stale")
    );

    await expect(
      handleInternalEvent({
        eventId: "event-2",
        type: "DRIVER_SHIFT_ENDED",
        driverId: "driver-1",
        occurredAt: "2026-07-26T06:00:00.000Z",
        traceId: "trace-2"
      })
    ).rejects.toThrow("snapshot stale");
  });

  it("maps the durable baseline event to a global recalculation", async () => {
    await handleInternalEvent({
      eventId: "baseline-recalculation:2026-07-26T06:00:00.000Z",
      type: "BASELINE_RECALCULATION",
      occurredAt: "2026-07-26T06:00:00.000Z",
      traceId: "trace-baseline"
    });

    expect(runDispatchApplication).toHaveBeenCalledWith(
      {
        type: "BASELINE_RECALCULATION",
        occurredAt: "2026-07-26T06:00:00.000Z",
        orderId: undefined,
        driverId: undefined,
        assignmentId: undefined
      },
      "trace-baseline"
    );
  });

  it("maps driver availability changes and preserves the driver trace context", async () => {
    await handleInternalEvent({
      eventId: "driver-availability:driver-1:2",
      type: "DRIVER_AVAILABILITY_CHANGED",
      driverId: "driver-1",
      occurredAt: "2026-08-16T06:00:00.000Z",
      traceId: "trace-availability"
    });

    expect(runDispatchApplication).toHaveBeenCalledTimes(1);
    expect(runDispatchApplication).toHaveBeenCalledWith(
      {
        type: "DRIVER_AVAILABILITY_CHANGED",
        occurredAt: "2026-08-16T06:00:00.000Z",
        orderId: undefined,
        driverId: "driver-1",
        assignmentId: undefined
      },
      "trace-availability"
    );
  });

  it("maps assignment unlocks and preserves all subject identifiers", async () => {
    await handleInternalEvent({
      eventId: "assignment-unlocked:assignment-1:4",
      type: "ASSIGNMENT_UNLOCKED",
      orderId: "order-1",
      driverId: "driver-1",
      assignmentId: "assignment-1",
      occurredAt: "2026-08-16T06:00:00.000Z",
      traceId: "trace-unlock"
    });

    expect(runDispatchApplication).toHaveBeenCalledTimes(1);
    expect(runDispatchApplication).toHaveBeenCalledWith(
      {
        type: "ASSIGNMENT_EXECUTION_CHANGED",
        occurredAt: "2026-08-16T06:00:00.000Z",
        orderId: "order-1",
        driverId: "driver-1",
        assignmentId: "assignment-1"
      },
      "trace-unlock"
    );
  });
});

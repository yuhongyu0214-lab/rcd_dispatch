import { beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueInternalEvent } from "./store";

const tx = {
  dispatchEventOutbox: {
    createMany: vi.fn()
  }
};

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// ---------------------------------------------------------------------------
// enqueueInternalEvent
// ---------------------------------------------------------------------------

describe("enqueueInternalEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits a new event successfully", async () => {
    tx.dispatchEventOutbox.createMany.mockResolvedValueOnce({ count: 1 });

    const result = await enqueueInternalEvent(tx as never, {
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      driverId: "driver-1",
      assignmentId: "asg-001",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001"
    });

    expect(result).toEqual({ eventId: "assign-asg-001", committed: true });
    expect(tx.dispatchEventOutbox.createMany).toHaveBeenCalledTimes(1);

    // Subject IDs are first-class columns so consumers do not parse eventId.
    const createArgs = tx.dispatchEventOutbox.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(createArgs.data[0]).toMatchObject({
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      driverId: "driver-1",
      assignmentId: "asg-001"
    });
  });

  it("returns DUPLICATE when createMany skips the stable eventId", async () => {
    tx.dispatchEventOutbox.createMany.mockResolvedValueOnce({ count: 0 });

    const result = await enqueueInternalEvent(tx as never, {
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001"
    });

    expect(result).toEqual({
      eventId: "assign-asg-001",
      committed: false,
      reason: "DUPLICATE"
    });
  });

  it("rethrows non-P2002 errors so the business transaction rolls back", async () => {
    tx.dispatchEventOutbox.createMany.mockRejectedValueOnce(
      new Error("Connection timeout")
    );

    await expect(
      enqueueInternalEvent(tx as never, {
        eventId: "assign-asg-001",
        type: "ASSIGNMENT_ASSIGNED",
        orderId: "order-1",
        occurredAt: "2026-07-19T08:00:00.000Z",
        traceId: "trace-001"
      })
    ).rejects.toThrow("Connection timeout");
  });

  it("does not classify an unexpected database error as duplicate", async () => {
    const error = Object.assign(new Error("Foreign key constraint failed"), {
      code: "P2003"
    });
    tx.dispatchEventOutbox.createMany.mockRejectedValueOnce(error);

    await expect(
      enqueueInternalEvent(tx as never, {
        eventId: "assign-asg-001",
        type: "ASSIGNMENT_ASSIGNED",
        orderId: "order-1",
        occurredAt: "2026-07-19T08:00:00.000Z",
        traceId: "trace-001"
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("same eventId with different occurredAt still produces DUPLICATE", async () => {
    // The outbox eventId unique key gates idempotency. Different occurredAt
    // values must not produce separate rows.
    tx.dispatchEventOutbox.createMany.mockResolvedValueOnce({ count: 1 });
    tx.dispatchEventOutbox.createMany.mockResolvedValueOnce({ count: 0 });

    // First write succeeds
    const first = await enqueueInternalEvent(tx as never, {
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001"
    });
    expect(first.committed).toBe(true);

    // Second write — same eventId, DIFFERENT occurredAt → DUPLICATE
    const second = await enqueueInternalEvent(tx as never, {
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:05.000Z",
      traceId: "trace-002"
    });
    expect(second).toEqual({
      eventId: "assign-asg-001",
      committed: false,
      reason: "DUPLICATE"
    });
  });
});

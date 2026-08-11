import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dispatchEventOutbox: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn()
    }
  }
}));

vi.mock("./dispatch-trigger", () => ({
  handleInternalEvent: vi.fn()
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { prisma } from "@/lib/prisma";

import { handleInternalEvent } from "./dispatch-trigger";
import {
  processInternalEvent,
  processPendingInternalEvents
} from "./processor";

const updateManyMock = prisma.dispatchEventOutbox
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueMock = prisma.dispatchEventOutbox
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyMock = prisma.dispatchEventOutbox
  .findMany as unknown as ReturnType<typeof vi.fn>;

const outboxRow = {
  id: "outbox-1",
  eventId: "event-1",
  type: "ORDER_UPDATED",
  orderId: "order-1",
  driverId: null,
  assignmentId: null,
  occurredAt: new Date("2026-07-26T06:00:00.000Z"),
  traceId: "trace-1",
  attempts: 1,
  availableAt: new Date("2026-07-26T06:00:00.000Z"),
  lockedAt: new Date("2026-07-26T06:01:00.000Z"),
  lockToken: "claimed-token",
  processedAt: null,
  lastError: null,
  createdAt: new Date("2026-07-26T06:00:00.000Z"),
  updatedAt: new Date("2026-07-26T06:01:00.000Z")
};

describe("dispatch event outbox processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockImplementation(
      async (args: { where: { eventId: string } }) => {
        const claimCall = [...updateManyMock.mock.calls]
          .reverse()
          .find(
            (call) =>
              typeof (call[0].data as { lockToken?: unknown }).lockToken ===
              "string"
          );
        return {
          ...outboxRow,
          eventId: args.where.eventId,
          lockToken: (claimCall?.[0].data as { lockToken: string }).lockToken
        };
      }
    );
  });

  it("claims and marks an event processed only after dispatch succeeds", async () => {
    vi.mocked(handleInternalEvent).mockResolvedValue({
      shouldTriggerDispatch: true
    });

    await expect(processInternalEvent("event-1")).resolves.toBe("processed");

    expect(handleInternalEvent).toHaveBeenCalledWith({
      eventId: "event-1",
      type: "ORDER_UPDATED",
      orderId: "order-1",
      driverId: undefined,
      assignmentId: undefined,
      occurredAt: "2026-07-26T06:00:00.000Z",
      traceId: "trace-1"
    });
    expect(prisma.dispatchEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: "outbox-1",
        processedAt: null
      }),
      data: expect.objectContaining({
        processedAt: expect.any(Date),
        lockedAt: null,
        lockToken: null,
        lastError: null
      })
    });
  });

  it("retains a failed event and schedules a retry", async () => {
    vi.mocked(handleInternalEvent).mockRejectedValue(
      new Error("dispatch failed")
    );

    await expect(processInternalEvent("event-1")).rejects.toThrow(
      "dispatch failed"
    );

    expect(prisma.dispatchEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: "outbox-1",
        processedAt: null
      }),
      data: expect.objectContaining({
        availableAt: expect.any(Date),
        lockedAt: null,
        lockToken: null,
        lastError: "dispatch failed"
      })
    });
  });

  it("does not report processed when another worker took over the lease", async () => {
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    vi.mocked(handleInternalEvent).mockResolvedValue({
      shouldTriggerDispatch: true
    });

    await expect(processInternalEvent("event-1")).resolves.toBe("skipped");
  });

  it("drains pending events and isolates individual failures", async () => {
    findManyMock.mockResolvedValue([
      { eventId: "event-1" },
      { eventId: "event-2" }
    ]);
    vi.mocked(handleInternalEvent)
      .mockResolvedValueOnce({ shouldTriggerDispatch: true })
      .mockRejectedValueOnce(new Error("retry later"));

    await expect(processPendingInternalEvents(2)).resolves.toEqual({
      processed: 1,
      failed: 1
    });
  });
});

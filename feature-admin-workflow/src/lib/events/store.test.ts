import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

import { commitInternalEvent } from "./store";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orderSourceEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// commitInternalEvent
// ---------------------------------------------------------------------------

describe("commitInternalEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits a new event successfully", async () => {
    vi.mocked(prisma.orderSourceEvent.create).mockResolvedValueOnce({
      id: "evt-1",
    } as never);

    const result = await commitInternalEvent({
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      driverId: "driver-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001",
    });

    expect(result).toEqual({ eventId: "assign-asg-001", committed: true });
    expect(prisma.orderSourceEvent.create).toHaveBeenCalledTimes(1);
  });

  it("returns DUPLICATE for P2002 unique constraint violation", async () => {
    vi.mocked(prisma.orderSourceEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.3",
      })
    );

    const result = await commitInternalEvent({
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001",
    });

    expect(result).toEqual({
      eventId: "assign-asg-001",
      committed: false,
      reason: "DUPLICATE",
    });
  });

  it("returns committed:false (no reason) for non-P2002 errors", async () => {
    vi.mocked(prisma.orderSourceEvent.create).mockRejectedValueOnce(
      new Error("Connection timeout")
    );

    const result = await commitInternalEvent({
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001",
    });

    expect(result).toEqual({
      eventId: "assign-asg-001",
      committed: false,
    });
  });

  it("does NOT match a non-P2002 Prisma error as duplicate", async () => {
    // A different Prisma error code — should not be classified as DUPLICATE.
    vi.mocked(prisma.orderSourceEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
        code: "P2003",
        clientVersion: "6.19.3",
      })
    );

    const result = await commitInternalEvent({
      eventId: "assign-asg-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001",
    });

    expect(result).toEqual({
      eventId: "assign-asg-001",
      committed: false,
    });
    // reason must NOT be "DUPLICATE" for non-P2002 errors
    expect(result.reason).toBeUndefined();
  });
});

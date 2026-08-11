import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockEnqueueInternalEvent } = vi.hoisted(() => {
  const tx = {};
  return {
    mockPrisma: {
      $transaction: vi.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    },
    mockEnqueueInternalEvent: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("./store", () => ({
  enqueueInternalEvent: mockEnqueueInternalEvent
}));

import {
  BASELINE_INTERVAL_MS,
  enqueueCurrentBaselineRecalculation
} from "./baseline";

describe("enqueueCurrentBaselineRecalculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueInternalEvent.mockResolvedValue({
      eventId: "baseline",
      committed: true
    });
  });

  it("uses a stable UTC ten-minute bucket eventId", async () => {
    await enqueueCurrentBaselineRecalculation(
      "trace-1",
      new Date("2026-07-26T06:09:59.999Z")
    );
    await enqueueCurrentBaselineRecalculation(
      "trace-2",
      new Date("2026-07-26T06:00:01.000Z")
    );

    expect(BASELINE_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(mockEnqueueInternalEvent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        eventId: "baseline-recalculation:2026-07-26T06:00:00.000Z",
        type: "BASELINE_RECALCULATION",
        occurredAt: "2026-07-26T06:00:00.000Z",
        traceId: "trace-1"
      }
    );
    expect(mockEnqueueInternalEvent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        eventId: "baseline-recalculation:2026-07-26T06:00:00.000Z"
      })
    );
  });

  it("advances the eventId at the next ten-minute boundary", async () => {
    await enqueueCurrentBaselineRecalculation(
      "trace-3",
      new Date("2026-07-26T06:10:00.000Z")
    );

    expect(mockEnqueueInternalEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "baseline-recalculation:2026-07-26T06:10:00.000Z",
        occurredAt: "2026-07-26T06:10:00.000Z"
      })
    );
  });
});

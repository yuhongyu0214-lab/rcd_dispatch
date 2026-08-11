import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("./dispatch-trigger", () => ({
  handleInternalEvent: vi.fn()
}));

import { prisma } from "@/lib/prisma";

import { handleInternalEvent } from "./dispatch-trigger";
import { processInternalEvent } from "./processor";

const describeDatabase =
  process.env.GATE3_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const eventPrefix = `gate3-integration:${process.pid}:`;

describeDatabase("Gate 3 real database outbox leases", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.dispatchEventOutbox.deleteMany({
      where: { eventId: { startsWith: eventPrefix } }
    });
  });

  afterAll(async () => {
    await prisma.dispatchEventOutbox.deleteMany({
      where: { eventId: { startsWith: eventPrefix } }
    });
    await prisma.$disconnect();
  });

  it("allows only one concurrent worker to claim and complete an event", async () => {
    const eventId = `${eventPrefix}${randomUUID()}`;
    await prisma.dispatchEventOutbox.create({
      data: {
        eventId,
        type: "BASELINE_RECALCULATION",
        occurredAt: new Date(),
        traceId: "gate3-multi-worker"
      }
    });
    vi.mocked(handleInternalEvent).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ shouldTriggerDispatch: true }),
            100
          );
        })
    );

    const results = await Promise.all([
      processInternalEvent(eventId),
      processInternalEvent(eventId)
    ]);
    expect(results.sort()).toEqual(["processed", "skipped"]);

    const row = await prisma.dispatchEventOutbox.findUniqueOrThrow({
      where: { eventId }
    });
    expect(row.attempts).toBe(1);
    expect(row.processedAt).not.toBeNull();
    expect(row.lockToken).toBeNull();
  });

  it("records failure backoff and succeeds on a later retry", async () => {
    const eventId = `${eventPrefix}${randomUUID()}`;
    await prisma.dispatchEventOutbox.create({
      data: {
        eventId,
        type: "ORDER_UPDATED",
        occurredAt: new Date(),
        traceId: "gate3-retry"
      }
    });
    vi.mocked(handleInternalEvent).mockRejectedValueOnce(
      new Error("gate3-controlled-failure")
    );

    await expect(processInternalEvent(eventId)).rejects.toThrow(
      "gate3-controlled-failure"
    );
    const failed = await prisma.dispatchEventOutbox.findUniqueOrThrow({
      where: { eventId }
    });
    expect(failed.attempts).toBe(1);
    expect(failed.processedAt).toBeNull();
    expect(failed.lockedAt).toBeNull();
    expect(failed.lockToken).toBeNull();
    expect(failed.lastError).toBe("gate3-controlled-failure");
    expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.dispatchEventOutbox.update({
      where: { eventId },
      data: { availableAt: new Date(Date.now() - 1_000) }
    });
    vi.mocked(handleInternalEvent).mockResolvedValueOnce({
      shouldTriggerDispatch: true
    });

    await expect(processInternalEvent(eventId)).resolves.toBe("processed");
    const retried = await prisma.dispatchEventOutbox.findUniqueOrThrow({
      where: { eventId }
    });
    expect(retried.attempts).toBe(2);
    expect(retried.processedAt).not.toBeNull();
    expect(retried.lastError).toBeNull();
  });

  it("takes over a stale claim lease", async () => {
    const eventId = `${eventPrefix}${randomUUID()}`;
    await prisma.dispatchEventOutbox.create({
      data: {
        eventId,
        type: "BASELINE_RECALCULATION",
        occurredAt: new Date(),
        traceId: "gate3-stale-lease",
        lockedAt: new Date(Date.now() - 120_000),
        lockToken: "abandoned-worker"
      }
    });
    vi.mocked(handleInternalEvent).mockResolvedValue({
      shouldTriggerDispatch: true
    });

    await expect(processInternalEvent(eventId)).resolves.toBe("processed");
    const row = await prisma.dispatchEventOutbox.findUniqueOrThrow({
      where: { eventId }
    });
    expect(row.attempts).toBe(1);
    expect(row.processedAt).not.toBeNull();
    expect(row.lockToken).toBeNull();
  });
});

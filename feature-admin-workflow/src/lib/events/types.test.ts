import { describe, expect, it } from "vitest";

import {
  WHITELISTED_EVENT_TYPES,
  type InternalEvent,
  type WhitelistedEventType,
} from "./types";

// ---------------------------------------------------------------------------
// G3-0 contract regression: whitelist integrity
// ---------------------------------------------------------------------------

describe("WHITELISTED_EVENT_TYPES", () => {
  it("contains all four 2B execution lifecycle events", () => {
    expect(WHITELISTED_EVENT_TYPES).toContain("DEPART");
    expect(WHITELISTED_EVENT_TYPES).toContain("ARRIVE");
    expect(WHITELISTED_EVENT_TYPES).toContain("COMPLETE");
    expect(WHITELISTED_EVENT_TYPES).toContain("MODULE_CHANGE_APPLIED");
  });

  it("contains exactly 14 entries covering 1A, 1B, Gate 3, and 2B", () => {
    // 3 (1A) + 3 (1B) + 4 (Gate 3) + 4 (2B) = 14
    expect(WHITELISTED_EVENT_TYPES).toHaveLength(14);
  });

  it("no duplicates in the whitelist", () => {
    expect(new Set(WHITELISTED_EVENT_TYPES).size).toBe(
      WHITELISTED_EVENT_TYPES.length
    );
  });
});

describe("InternalEvent type (compile-time shape verified at runtime)", () => {
  it("accepts assignmentId as an optional field", () => {
    const event: InternalEvent = {
      eventId: "evt-001",
      type: "ASSIGNMENT_ASSIGNED",
      orderId: "order-1",
      driverId: "driver-1",
      assignmentId: "asg-001",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-001",
    };
    expect(event.assignmentId).toBe("asg-001");
  });

  it("accepts events without assignmentId (backward compat)", () => {
    const event: InternalEvent = {
      eventId: "evt-002",
      type: "ORDER_CREATED",
      orderId: "order-2",
      occurredAt: "2026-07-19T08:00:00.000Z",
      traceId: "trace-002",
    };
    expect(event.assignmentId).toBeUndefined();
  });

  it("WhitelistedEventType rejects an arbitrary non-whitelisted string", () => {
    // Compile-time check: assigning a non-whitelisted literal should fail.
    // At runtime, TypeScript types are erased, so we verify indirectly by
    // checking it's not in the const array.
    const bogus = "UNKNOWN_EVENT_TYPE";
    expect(
      (WHITELISTED_EVENT_TYPES as readonly string[]).includes(bogus)
    ).toBe(false);
  });
});

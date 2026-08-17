import { describe, expect, it } from "vitest";

import { getOrCreateTraceId } from "./trace";

describe("getOrCreateTraceId", () => {
  it("preserves a valid incoming trace ID", () => {
    expect(
      getOrCreateTraceId(new Headers({ "X-Trace-Id": "trace.import:001" }))
    ).toBe("trace.import:001");
  });

  it("generates a UUID when the trace ID is missing or unsafe", () => {
    for (const headers of [
      new Headers(),
      new Headers({ "X-Trace-Id": "trace id with spaces" }),
      new Headers({ "X-Trace-Id": "x".repeat(129) })
    ]) {
      expect(getOrCreateTraceId(headers)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    }
  });
});

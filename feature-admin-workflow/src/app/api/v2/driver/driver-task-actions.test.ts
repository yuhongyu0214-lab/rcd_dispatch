import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/driver/_utils", () => ({
  extractDriverId: vi.fn()
}));

vi.mock("@/lib/assignments-v2/assignment-command-service", () => ({
  executeDriverAssignmentAction: vi.fn()
}));

import { extractDriverId } from "@/app/api/driver/_utils";
import { executeDriverAssignmentAction } from "@/lib/assignments-v2/assignment-command-service";

import { POST as arrive } from "./tasks/[assignmentId]/arrive/route";
import { POST as complete } from "./tasks/[assignmentId]/complete/route";
import { POST as depart } from "./tasks/[assignmentId]/depart/route";

function request(action: string) {
  return new Request(
    `http://localhost/api/v2/driver/tasks/assignment-1/${action}`,
    {
      method: "POST",
      headers: { "X-Trace-Id": `trace-${action}` }
    }
  );
}

const context = {
  params: Promise.resolve({ assignmentId: "assignment-1" })
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractDriverId).mockResolvedValue("driver-1");
  vi.mocked(executeDriverAssignmentAction).mockResolvedValue({
    success: true,
    data: {
      assignmentId: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      executionStatus: "EN_ROUTE",
      planVersion: 2,
      replayed: false
    }
  });
});

describe("V2 driver assignment action routes", () => {
  it("rejects anonymous action requests", async () => {
    vi.mocked(extractDriverId).mockResolvedValue(null);

    const response = await depart(request("depart"), context);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(executeDriverAssignmentAction).not.toHaveBeenCalled();
  });

  it.each([
    ["DEPART", "depart", depart],
    ["ARRIVE", "arrive", arrive],
    ["COMPLETE", "complete", complete]
  ] as const)("delegates %s using only the authenticated driver identity", async (
    action,
    path,
    handler
  ) => {
    const response = await handler(request(path), context);

    expect(response.status).toBe(200);
    expect(executeDriverAssignmentAction).toHaveBeenCalledWith({
      action,
      assignmentId: "assignment-1",
      driverId: "driver-1",
      traceId: `trace-${path}`
    });
  });

  it("preserves a structured forbidden response from the command service", async () => {
    vi.mocked(executeDriverAssignmentAction).mockResolvedValue({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Drivers may only operate their own assignments"
      }
    });

    const response = await depart(request("depart"), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(response.headers.get("X-Trace-Id")).toBe("trace-depart");
  });
});

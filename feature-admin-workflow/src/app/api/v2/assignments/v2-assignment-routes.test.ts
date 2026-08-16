import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn()
}));

vi.mock("@/lib/assignments-v2/assignment-command-service", () => ({
  assignOrder: vi.fn(),
  reassignAssignment: vi.fn(),
  unlockAssignment: vi.fn(),
  withdrawAssignment: vi.fn()
}));

import {
  assignOrder,
  reassignAssignment,
  unlockAssignment,
  withdrawAssignment
} from "@/lib/assignments-v2/assignment-command-service";
import { getCurrentUser } from "@/lib/auth/current-user";

import { POST as assign } from "./route";
import { POST as reassign } from "./[assignmentId]/reassign/route";
import { POST as unlock } from "./[assignmentId]/unlock/route";
import { POST as withdraw } from "./[assignmentId]/withdraw/route";

const context = {
  params: Promise.resolve({ assignmentId: "assignment-1" })
};

function request(body: unknown) {
  return new Request(
    "http://localhost/api/v2/assignments/assignment-1/reassign",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Trace-Id": "trace-reassign-route"
      },
      body: JSON.stringify(body)
    }
  );
}

function commandRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Trace-Id": "trace-assignment-route"
    },
    body: JSON.stringify(body)
  });
}

function command() {
  return {
    toDriverId: "driver-2",
    reason: "G3E2E manual reroute",
    expectedFromPlanVersion: 7,
    expectedToPlanVersion: 3
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "dispatcher-1",
    email: "dispatcher@example.test",
    name: "调度员",
    role: "dispatcher",
    driverId: null
  });
  vi.mocked(reassignAssignment).mockResolvedValue({
    success: true,
    data: {
      assignmentId: "assignment-2",
      previousAssignmentId: "assignment-1",
      orderId: "order-1",
      fromDriverId: "driver-1",
      toDriverId: "driver-2",
      fromPlanVersion: 8,
      toPlanVersion: 4,
      replayed: false
    }
  });
  vi.mocked(assignOrder).mockResolvedValue({
    success: true,
    data: {
      assignmentId: "assignment-new",
      orderId: "order-1",
      driverId: "driver-1",
      planVersion: 5,
      replayed: false
    }
  });
  vi.mocked(withdrawAssignment).mockResolvedValue({
    success: true,
    data: {
      assignmentId: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      planVersion: 8,
      replayed: false
    }
  });
  vi.mocked(unlockAssignment).mockResolvedValue({
    success: true,
    data: {
      assignmentId: "assignment-1",
      orderId: "order-1",
      driverId: "driver-1",
      planVersion: 8,
      replayed: false
    }
  });
});

describe("POST /api/v2/assignments/{assignmentId}/reassign", () => {
  it("rejects an anonymous caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await reassign(request(command()), context);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(reassignAssignment).not.toHaveBeenCalled();
  });

  it("rejects a driver caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "driver-user-1",
      email: "driver@example.test",
      name: "司机",
      role: "driver",
      driverId: "driver-1"
    });

    const response = await reassign(request(command()), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects missing dual plan versions before calling the service", async () => {
    const response = await reassign(
      request({ toDriverId: "driver-2", reason: "manual" }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields).toEqual({
      expectedFromPlanVersion: ["Expected integer"],
      expectedToPlanVersion: ["Expected integer"]
    });
    expect(reassignAssignment).not.toHaveBeenCalled();
  });

  it("passes the frozen dual-version command and dispatcher identity", async () => {
    const response = await reassign(request(command()), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(reassignAssignment).toHaveBeenCalledWith({
      assignmentId: "assignment-1",
      ...command(),
      operatorUserId: "dispatcher-1",
      traceId: "trace-reassign-route"
    });
  });

  it("returns service version conflicts as structured 409 responses", async () => {
    vi.mocked(reassignAssignment).mockResolvedValue({
      success: false,
      error: {
        code: "PLAN_VERSION_CONFLICT",
        message: "stale",
        details: {
          currentFromPlanVersion: 8,
          currentToPlanVersion: 4
        }
      }
    });

    const response = await reassign(request(command()), context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.details).toEqual({
      currentFromPlanVersion: 8,
      currentToPlanVersion: 4
    });
  });
});

describe("dispatcher assignment plan-edit routes", () => {
  it("passes the manual assignment command and dispatcher identity", async () => {
    const response = await assign(
      commandRequest("http://localhost/api/v2/assignments", {
        orderId: "order-1",
        driverId: "driver-1",
        reason: " 人工锁定 ",
        expectedPlanVersion: 4
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(assignOrder).toHaveBeenCalledWith({
      orderId: "order-1",
      driverId: "driver-1",
      reason: "人工锁定",
      expectedPlanVersion: 4,
      operatorUserId: "dispatcher-1",
      traceId: "trace-assignment-route"
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("returns manual assignment ETA dependency failures as trace-consistent 503 responses", async () => {
    vi.mocked(assignOrder).mockResolvedValue({
      success: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "ETA calculation is unavailable",
        details: { dependency: "AMAP" }
      }
    });

    const response = await assign(
      commandRequest("http://localhost/api/v2/assignments", {
        orderId: "order-1",
        driverId: "driver-1",
        reason: "人工锁定",
        expectedPlanVersion: 4
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "ETA calculation is unavailable",
      details: { dependency: "AMAP" }
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(body.traceId).toBe("trace-assignment-route");
  });

  it("requires expectedPlanVersion for withdrawal", async () => {
    const response = await withdraw(
      commandRequest(
        "http://localhost/api/v2/assignments/assignment-1/withdraw",
        { reason: "撤回" }
      ),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.details.fields.expectedPlanVersion).toEqual([
      "Expected integer"
    ]);
    expect(withdrawAssignment).not.toHaveBeenCalled();
  });

  it("passes a valid withdrawal plan edit", async () => {
    const response = await withdraw(
      commandRequest(
        "http://localhost/api/v2/assignments/assignment-1/withdraw",
        { reason: "撤回", expectedPlanVersion: 7 }
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(withdrawAssignment).toHaveBeenCalledWith({
      assignmentId: "assignment-1",
      reason: "撤回",
      expectedPlanVersion: 7,
      operatorUserId: "dispatcher-1",
      traceId: "trace-assignment-route"
    });
  });

  it("returns unlock version conflicts as structured 409 responses", async () => {
    vi.mocked(unlockAssignment).mockResolvedValue({
      success: false,
      error: {
        code: "PLAN_VERSION_CONFLICT",
        message: "stale",
        details: { currentPlanVersion: 9 }
      }
    });

    const response = await unlock(
      commandRequest(
        "http://localhost/api/v2/assignments/assignment-1/unlock",
        { reason: "解除锁定", expectedPlanVersion: 7 }
      ),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.details).toEqual({ currentPlanVersion: 9 });
  });
});

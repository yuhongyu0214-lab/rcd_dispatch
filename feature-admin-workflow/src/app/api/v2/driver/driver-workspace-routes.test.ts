import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/driver/_utils", () => ({ extractDriverId: vi.fn() }));
vi.mock("@/lib/driver-v2/read-service", () => ({
  listDriverTasks: vi.fn(),
  listUnassignedOrders: vi.fn()
}));
vi.mock("@/lib/driver-v2/module-command-service", () => ({
  updateDriverServiceModules: vi.fn()
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { extractDriverId } from "@/app/api/driver/_utils";
import { updateDriverServiceModules } from "@/lib/driver-v2/module-command-service";
import {
  listDriverTasks,
  listUnassignedOrders
} from "@/lib/driver-v2/read-service";

import { GET as getUnassigned } from "./orders/unassigned/route";
import { GET as getTasks } from "./tasks/route";
import { PUT as putModules } from "./tasks/[assignmentId]/modules/route";

const context = { params: Promise.resolve({ assignmentId: "assignment-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractDriverId).mockResolvedValue("driver-self");
  vi.mocked(listDriverTasks).mockResolvedValue([]);
  vi.mocked(listUnassignedOrders).mockResolvedValue([]);
  vi.mocked(updateDriverServiceModules).mockResolvedValue({
    success: true,
    data: { servicePlan: null, planVersion: 4, replayed: true }
  });
});

describe("driver workspace V2 routes", () => {
  it("rejects anonymous task reads", async () => {
    vi.mocked(extractDriverId).mockResolvedValue(null);
    const response = await getTasks(
      new Request("http://localhost/api/v2/driver/tasks")
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(listDriverTasks).not.toHaveBeenCalled();
  });

  it("uses only the authenticated identity for task reads", async () => {
    vi.mocked(listDriverTasks).mockResolvedValue([
      {
        id: "assignment-1",
        orderId: "order-1",
        orderNo: "ORDER-1",
        businessType: "STORE_PICKUP",
        executionStatus: "PLANNED",
        slot: "A",
        lockType: "NONE",
        feasibility: "UNKNOWN",
        promisedPickupAt: "2026-08-17T08:00:00.000Z",
        servicePlan: null
      }
    ]);
    const response = await getTasks(
      new Request(
        "http://localhost/api/v2/driver/tasks?driverId=driver-attacker",
        { headers: { "X-Trace-Id": "trace-read" } }
      )
    );

    expect(response.status).toBe(200);
    expect(listDriverTasks).toHaveBeenCalledWith("driver-self");
    expect(response.headers.get("X-Trace-Id")).toBe("trace-read");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: "assignment-1", servicePlan: null }],
      traceId: "trace-read"
    });
  });

  it("requires driver authentication before listing unassigned orders", async () => {
    vi.mocked(extractDriverId).mockResolvedValue(null);
    const response = await getUnassigned(
      new Request("http://localhost/api/v2/driver/orders/unassigned")
    );

    expect(response.status).toBe(401);
    expect(listUnassignedOrders).not.toHaveBeenCalled();
  });

  it("rejects expectedPlanVersion on module fact commands", async () => {
    const response = await putModules(
      new Request("http://localhost/api/v2/driver/tasks/assignment-1/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modules: ["WASHING"],
          expectedPlanVersion: 3
        })
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(updateDriverServiceModules).not.toHaveBeenCalled();
  });

  it("validates modules and passes a canonical set with authenticated identity", async () => {
    const response = await putModules(
      new Request(
        "http://localhost/api/v2/driver/tasks/assignment-1/modules?driverId=driver-attacker",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "X-Trace-Id": "trace-modules"
          },
          body: JSON.stringify({
            driverId: "driver-attacker",
            modules: ["WASHING", "CHARGING"]
          })
        }
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(updateDriverServiceModules).toHaveBeenCalledWith({
      assignmentId: "assignment-1",
      driverId: "driver-self",
      modules: ["CHARGING", "WASHING"],
      traceId: "trace-modules"
    });
  });

  it("keeps the V2 error envelope when the module service rejects", async () => {
    vi.mocked(updateDriverServiceModules).mockRejectedValue(
      new Error("unexpected command failure")
    );
    const response = await putModules(
      new Request("http://localhost/api/v2/driver/tasks/assignment-1/modules", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "X-Trace-Id": "trace-module-failure"
        },
        body: JSON.stringify({ modules: ["WASHING"] })
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Trace-Id")).toBe("trace-module-failure");
    expect(body).toMatchObject({
      success: false,
      error: { code: "INTERNAL_ERROR" },
      traceId: "trace-module-failure"
    });
  });
});

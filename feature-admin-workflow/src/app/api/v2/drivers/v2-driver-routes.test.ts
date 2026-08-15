import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/dispatcher-v2/read-service", () => ({
  listDrivers: vi.fn(),
  getDriverPlan: vi.fn()
}));
vi.mock("@/lib/dispatcher-v2/driver-command-service", () => ({
  setDriverAvailability: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { setDriverAvailability } from "@/lib/dispatcher-v2/driver-command-service";
import { getDriverPlan, listDrivers } from "@/lib/dispatcher-v2/read-service";

import { GET as list } from "./route";
import { PATCH as availability } from "./[driverId]/availability/route";
import { GET as plan } from "./[driverId]/plan/route";

const context = { params: Promise.resolve({ driverId: "driver-1" }) };

function request(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Trace-Id": "trace-driver-route"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
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
  vi.mocked(listDrivers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20
  });
  vi.mocked(getDriverPlan).mockResolvedValue(null);
  vi.mocked(setDriverAvailability).mockResolvedValue({
    success: true,
    data: {
      driverId: "driver-1",
      availability: "UNAVAILABLE",
      planVersion: 4,
      releasedAssignmentIds: [],
      replayed: false
    }
  });
});

describe("dispatcher driver routes", () => {
  it("clamps driver pageSize to 100", async () => {
    const response = await list(
      request("http://localhost/api/v2/drivers?page=3&pageSize=101")
    );

    expect(response.status).toBe(200);
    expect(listDrivers).toHaveBeenCalledWith({ page: 3, pageSize: 100 });
  });

  it("rejects invalid pagination before reading drivers", async () => {
    const response = await list(
      request("http://localhost/api/v2/drivers?page=nope")
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
    expect(listDrivers).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown driver plan", async () => {
    const response = await plan(
      request("http://localhost/api/v2/drivers/driver-1/plan"),
      context
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("rejects an anonymous availability change", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await availability(
      request(
        "http://localhost/api/v2/drivers/driver-1/availability",
        "PATCH",
        { availability: "UNAVAILABLE", reason: "停派" }
      ),
      context
    );

    expect(response.status).toBe(401);
    expect(setDriverAvailability).not.toHaveBeenCalled();
  });

  it("validates the availability enum and reason", async () => {
    const response = await availability(
      request(
        "http://localhost/api/v2/drivers/driver-1/availability",
        "PATCH",
        { availability: "OFFLINE", reason: "" }
      ),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.details.fields).toEqual({
      availability: ["Expected AVAILABLE or UNAVAILABLE"],
      reason: ["Required"]
    });
  });

  it("sets availability without a client plan version and preserves trace ID", async () => {
    const response = await availability(
      request(
        "http://localhost/api/v2/drivers/driver-1/availability",
        "PATCH",
        { availability: "UNAVAILABLE", reason: " 临时停派 " }
      ),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(setDriverAvailability).toHaveBeenCalledWith({
      driverId: "driver-1",
      availability: "UNAVAILABLE",
      reason: "临时停派",
      operatorUserId: "dispatcher-1",
      traceId: "trace-driver-route"
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });
});

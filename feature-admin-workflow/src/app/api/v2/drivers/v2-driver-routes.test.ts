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

function request(
  url: string,
  method = "GET",
  body?: unknown,
  traceId: string | null = "trace-driver-route"
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (traceId !== null) headers.set("X-Trace-Id", traceId);
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const driverOperations = [
  {
    name: "GET /api/v2/drivers",
    invoke: (traceId: string | null = "trace-driver-route") =>
      list(
        request("http://localhost/api/v2/drivers", "GET", undefined, traceId)
      ),
    service: listDrivers
  },
  {
    name: "GET /api/v2/drivers/{driverId}/plan",
    invoke: (traceId: string | null = "trace-driver-route") =>
      plan(
        request(
          "http://localhost/api/v2/drivers/driver-1/plan",
          "GET",
          undefined,
          traceId
        ),
        context
      ),
    service: getDriverPlan
  },
  {
    name: "PATCH /api/v2/drivers/{driverId}/availability",
    invoke: (traceId: string | null = "trace-driver-route") =>
      availability(
        request(
          "http://localhost/api/v2/drivers/driver-1/availability",
          "PATCH",
          { availability: "UNAVAILABLE", reason: "停派" },
          traceId
        ),
        context
      ),
    service: setDriverAvailability
  }
] as const;

async function expectTrace(
  response: Response,
  expectedTraceId = "trace-driver-route"
) {
  const body = await response.json();
  expect(body.traceId).toBe(expectedTraceId);
  expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  return body;
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
  it.each(driverOperations)(
    "returns 401 with a matching trace ID for $name",
    async ({ invoke, service }) => {
      vi.mocked(getCurrentUser).mockResolvedValue(null);

      const response = await invoke();
      const body = await expectTrace(response);

      expect(response.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(service).not.toHaveBeenCalled();
    }
  );

  it.each(driverOperations)(
    "returns 403 with a matching trace ID for $name",
    async ({ invoke, service }) => {
      vi.mocked(getCurrentUser).mockResolvedValue({
        id: "driver-user-1",
        email: "driver@example.test",
        name: "司机",
        role: "driver",
        driverId: "driver-1"
      });

      const response = await invoke();
      const body = await expectTrace(response);

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(service).not.toHaveBeenCalled();
    }
  );

  it.each(driverOperations)(
    "preserves the supplied trace ID for $name",
    async ({ invoke }) => {
      await expectTrace(await invoke());
    }
  );

  it.each(driverOperations)(
    "generates a default UUID trace ID for $name",
    async ({ invoke }) => {
      const response = await invoke(null);
      const body = await response.json();

      expect(body.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    }
  );

  it("uses driver pagination defaults", async () => {
    const response = await list(request("http://localhost/api/v2/drivers"));

    expect(response.status).toBe(200);
    expect(listDrivers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("clamps driver pageSize to 100", async () => {
    const response = await list(
      request("http://localhost/api/v2/drivers?page=3&pageSize=101")
    );

    expect(response.status).toBe(200);
    expect(listDrivers).toHaveBeenCalledWith({ page: 3, pageSize: 100 });
  });

  it.each(["nope", "0"])(
    "rejects page=%s before reading drivers",
    async (page) => {
      const response = await list(
        request(`http://localhost/api/v2/drivers?page=${page}`)
      );
      const body = await expectTrace(response);

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(listDrivers).not.toHaveBeenCalled();
    }
  );

  it("returns 404 for an unknown driver plan", async () => {
    const response = await plan(
      request("http://localhost/api/v2/drivers/driver-1/plan"),
      context
    );
    const body = await expectTrace(response);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
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

    await expectTrace(response);
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
    const body = await expectTrace(response);

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

  it("rejects expectedPlanVersion on availability before calling the service", async () => {
    const response = await availability(
      request(
        "http://localhost/api/v2/drivers/driver-1/availability",
        "PATCH",
        {
          availability: "UNAVAILABLE",
          reason: "停派",
          expectedPlanVersion: 4
        }
      ),
      context
    );
    const body = await expectTrace(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields.expectedPlanVersion).toEqual([
      "Must not be provided"
    ]);
    expect(setDriverAvailability).not.toHaveBeenCalled();
  });
});

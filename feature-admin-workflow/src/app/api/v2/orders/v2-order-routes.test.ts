import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/dispatcher-v2/read-service", () => ({
  listOrders: vi.fn(),
  getOrderDetail: vi.fn()
}));
vi.mock("@/lib/dispatcher-v2/order-command-service", () => ({
  updateOrder: vi.fn(),
  cancelOrder: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { cancelOrder, updateOrder } from "@/lib/dispatcher-v2/order-command-service";
import { getOrderDetail, listOrders } from "@/lib/dispatcher-v2/read-service";

import { GET as list } from "./route";
import { GET as detail, PATCH as update } from "./[orderId]/route";
import { POST as cancel } from "./[orderId]/cancel/route";

const context = { params: Promise.resolve({ orderId: "order-1" }) };

function request(
  url: string,
  method = "GET",
  body?: unknown,
  traceId: string | null = "trace-order-route"
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (traceId !== null) headers.set("X-Trace-Id", traceId);
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const orderOperations = [
  {
    name: "GET /api/v2/orders",
    invoke: (traceId: string | null = "trace-order-route") =>
      list(
        request("http://localhost/api/v2/orders", "GET", undefined, traceId)
      ),
    service: listOrders
  },
  {
    name: "GET /api/v2/orders/{orderId}",
    invoke: (traceId: string | null = "trace-order-route") =>
      detail(
        request(
          "http://localhost/api/v2/orders/order-1",
          "GET",
          undefined,
          traceId
        ),
        context
      ),
    service: getOrderDetail
  },
  {
    name: "PATCH /api/v2/orders/{orderId}",
    invoke: (traceId: string | null = "trace-order-route") =>
      update(
        request(
          "http://localhost/api/v2/orders/order-1",
          "PATCH",
          {
            promisedPickupAt: "2026-08-16T16:00:00+08:00",
            reason: "客户改期"
          },
          traceId
        ),
        context
      ),
    service: updateOrder
  },
  {
    name: "POST /api/v2/orders/{orderId}/cancel",
    invoke: (traceId: string | null = "trace-order-route") =>
      cancel(
        request(
          "http://localhost/api/v2/orders/order-1/cancel",
          "POST",
          { reason: "客户取消" },
          traceId
        ),
        context
      ),
    service: cancelOrder
  }
] as const;

async function expectTrace(response: Response, expectedTraceId: string) {
  const body = await response.json();
  expect(body.traceId).toBe(expectedTraceId);
  expect(response.headers.get("X-Trace-Id")).toBe(expectedTraceId);
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
  vi.mocked(listOrders).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20
  });
  vi.mocked(getOrderDetail).mockResolvedValue(null);
  vi.mocked(updateOrder).mockResolvedValue({
    success: true,
    data: { orderId: "order-1", planVersion: 5, replayed: false }
  });
  vi.mocked(cancelOrder).mockResolvedValue({
    success: true,
    data: { orderId: "order-1", replayed: false }
  });
});

describe("dispatcher order routes", () => {
  it.each(orderOperations)(
    "returns 401 with a matching trace ID for $name",
    async ({ invoke, service }) => {
      vi.mocked(getCurrentUser).mockResolvedValue(null);

      const response = await invoke();
      const body = await expectTrace(response, "trace-order-route");

      expect(response.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(service).not.toHaveBeenCalled();
    }
  );

  it.each(orderOperations)(
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
      const body = await expectTrace(response, "trace-order-route");

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(service).not.toHaveBeenCalled();
    }
  );

  it.each(orderOperations)(
    "preserves the supplied trace ID for $name",
    async ({ invoke }) => {
      await expectTrace(await invoke(), "trace-order-route");
    }
  );

  it.each(orderOperations)(
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

  it("uses pagination defaults and clamps pageSize to 100", async () => {
    await list(request("http://localhost/api/v2/orders"));
    expect(listOrders).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      executionStatus: undefined,
      feasibility: undefined,
      slot: undefined,
      storeCode: undefined,
      keyword: undefined
    });

    const response = await list(
      request("http://localhost/api/v2/orders?page=2&pageSize=999")
    );
    expect(response.status).toBe(200);
    expect(listOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 100 })
    );
  });

  it("returns structured validation errors for invalid filters", async () => {
    const response = await list(
      request(
        "http://localhost/api/v2/orders?page=0&executionStatus=BAD&slot=D"
      )
    );
    const body = await expectTrace(response, "trace-order-route");

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields).toEqual({
      page: ["Expected positive integer"],
      executionStatus: ["Unsupported execution status"],
      slot: ["Expected NONE, A, B, or C"]
    });
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown order detail", async () => {
    const response = await detail(
      request("http://localhost/api/v2/orders/order-1"),
      context
    );
    const body = await expectTrace(response, "trace-order-route");

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a timezone-free promised pickup time", async () => {
    const response = await update(
      request("http://localhost/api/v2/orders/order-1", "PATCH", {
        promisedPickupAt: "2026-08-16T08:00:00",
        reason: "客户改期"
      }),
      context
    );
    const body = await expectTrace(response, "trace-order-route");

    expect(response.status).toBe(400);
    expect(body.error.details.fields.promisedPickupAt).toEqual([
      "Expected ISO 8601 datetime with timezone"
    ]);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("passes a normalized dispatcher update command and preserves trace ID", async () => {
    const response = await update(
      request("http://localhost/api/v2/orders/order-1", "PATCH", {
        promisedPickupAt: "2026-08-16T16:00:00+08:00",
        pickupAddress: " 新取车点 ",
        reason: " 客户改期 "
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateOrder).toHaveBeenCalledWith({
      orderId: "order-1",
      promisedPickupAt: "2026-08-16T08:00:00.000Z",
      pickupAddress: "新取车点",
      deliveryAddress: undefined,
      reason: "客户改期",
      operatorUserId: "dispatcher-1",
      traceId: "trace-order-route"
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("returns address geocoding failures as trace-consistent 503 responses", async () => {
    vi.mocked(updateOrder).mockResolvedValue({
      success: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Address geocoding is unavailable",
        details: { dependency: "AMAP" }
      }
    });

    const response = await update(
      request("http://localhost/api/v2/orders/order-1", "PATCH", {
        pickupAddress: "新取车点",
        reason: "客户改址"
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Address geocoding is unavailable",
      details: { dependency: "AMAP" }
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(body.traceId).toBe("trace-order-route");
  });

  it("cancels without requiring a client plan version", async () => {
    const response = await cancel(
      request("http://localhost/api/v2/orders/order-1/cancel", "POST", {
        reason: "客户取消"
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith({
      orderId: "order-1",
      reason: "客户取消",
      operatorUserId: "dispatcher-1",
      traceId: "trace-order-route"
    });
  });

  it("rejects expectedPlanVersion on cancellation before calling the service", async () => {
    const response = await cancel(
      request("http://localhost/api/v2/orders/order-1/cancel", "POST", {
        reason: "客户取消",
        expectedPlanVersion: 4
      }),
      context
    );
    const body = await expectTrace(response, "trace-order-route");

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields.expectedPlanVersion).toEqual([
      "Must not be provided"
    ]);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

});

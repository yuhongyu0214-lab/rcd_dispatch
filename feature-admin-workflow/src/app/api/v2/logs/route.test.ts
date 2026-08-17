import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/observability-v2/read-service", () => ({
  listOperationLogs: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listOperationLogs } from "@/lib/observability-v2/read-service";

import { GET } from "./route";

const dispatcher = {
  id: "user-1",
  email: "dispatcher@example.test",
  name: "调度员",
  role: "admin",
  driverId: null
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function request(query = "", traceId: string | null = "trace-logs") {
  const headers = new Headers();
  if (traceId !== null) headers.set("X-Trace-Id", traceId);
  return new Request(`http://localhost/api/v2/logs${query}`, { headers });
}

describe("GET /api/v2/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(dispatcher);
    vi.mocked(listOperationLogs).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20
    });
  });

  it("returns an empty filtered page with matching trace IDs", async () => {
    const response = await GET(
      request(
        "?orderId=order-1&driverId=driver-1&traceId=business-trace&action=MODULE_CHANGE"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listOperationLogs).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      orderId: "order-1",
      driverId: "driver-1",
      traceId: "business-trace",
      action: "MODULE_CHANGE"
    });
    expect(body.data.items).toEqual([]);
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("rejects unsupported action filters", async () => {
    const response = await GET(request("?action=DROP_TABLE"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: { action: ["Unsupported operation action"] } }
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listOperationLogs).not.toHaveBeenCalled();
  });

  it("requires a dispatcher session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("rejects non-dispatcher roles with matching trace IDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...dispatcher,
      role: "driver",
      driverId: "driver-1"
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.traceId).toBe("trace-logs");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listOperationLogs).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["invalid", "trace id with spaces"]
  ])("generates a UUID for %s incoming trace IDs", async (_label, traceId) => {
    const response = await GET(request("", traceId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.traceId).toMatch(UUID_PATTERN);
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("rejects page zero and an invalid pageSize", async () => {
    const response = await GET(request("?page=0&pageSize=invalid"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: {
          page: ["Expected positive integer"],
          pageSize: ["Expected positive integer"]
        }
      }
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listOperationLogs).not.toHaveBeenCalled();
  });

  it("caps pageSize at 100", async () => {
    vi.mocked(listOperationLogs).mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 100
    });

    const response = await GET(request("?page=2&pageSize=999"));

    expect(response.status).toBe(200);
    expect(listOperationLogs).toHaveBeenCalledWith({
      page: 2,
      pageSize: 100,
      orderId: undefined,
      driverId: undefined,
      traceId: undefined,
      action: undefined
    });
  });

  it("returns a safe structured error when the read fails", async () => {
    vi.mocked(listOperationLogs).mockRejectedValue(new Error("db secret"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Failed to read operation logs"
    });
    expect(JSON.stringify(body)).not.toContain("db secret");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });
});

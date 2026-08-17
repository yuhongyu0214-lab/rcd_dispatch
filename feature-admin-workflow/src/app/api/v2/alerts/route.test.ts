import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/observability-v2/read-service", () => ({
  listAlerts: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listAlerts } from "@/lib/observability-v2/read-service";

import { GET } from "./route";

const dispatcher = {
  id: "user-1",
  email: "dispatcher@example.test",
  name: "调度员",
  role: "dispatcher",
  driverId: null
};

function request(query = "", traceId: string | null = "trace-alerts") {
  const headers = new Headers();
  if (traceId !== null) headers.set("X-Trace-Id", traceId);
  return new Request(`http://localhost/api/v2/alerts${query}`, { headers });
}

describe("GET /api/v2/alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(dispatcher);
    vi.mocked(listAlerts).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20
    });
  });

  it("requires dispatcher authentication with matching trace IDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.traceId).toBe("trace-alerts");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listAlerts).not.toHaveBeenCalled();
  });

  it("rejects non-dispatcher roles", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...dispatcher,
      role: "driver",
      driverId: "driver-1"
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.traceId).toBe("trace-alerts");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listAlerts).not.toHaveBeenCalled();
  });

  it("filters alert history and caps pageSize at 100", async () => {
    vi.mocked(listAlerts).mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 100
    });

    const response = await GET(request("?page=2&pageSize=999&status=RESOLVED"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listAlerts).toHaveBeenCalledWith({
      page: 2,
      pageSize: 100,
      status: "RESOLVED"
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("returns structured validation errors", async () => {
    const response = await GET(request("?page=0&status=CLOSED"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: {
          page: ["Expected positive integer"],
          status: ["Expected OPEN or RESOLVED"]
        }
      }
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("replaces an invalid incoming trace ID with a UUID", async () => {
    const response = await GET(request("", "trace id with spaces"));
    const body = await response.json();

    expect(body.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });

  it("keeps the trace envelope when authentication lookup fails", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(
      new Error("session lookup failed")
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(listAlerts).not.toHaveBeenCalled();
  });
});

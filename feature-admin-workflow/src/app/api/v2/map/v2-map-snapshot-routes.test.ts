import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/dispatcher-v2/read-service", () => ({
  getMapSnapshot: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { getMapSnapshot } from "@/lib/dispatcher-v2/read-service";

import { GET } from "./snapshot/route";

function request() {
  return new Request("http://localhost/api/v2/map/snapshot", {
    headers: { "X-Trace-Id": "trace-map" }
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
  vi.mocked(getMapSnapshot).mockResolvedValue({
    drivers: [],
    orders: [],
    openAlertCount: 2
  });
});

describe("GET /api/v2/map/snapshot", () => {
  it("returns 401 for an anonymous caller with matching trace IDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.traceId).toBe("trace-map");
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
    expect(getMapSnapshot).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-dispatcher", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "driver-user",
      email: "driver@example.test",
      name: "司机",
      role: "driver",
      driverId: "driver-1"
    });

    const response = await GET(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("returns the dispatcher snapshot in the unified envelope", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { drivers: [], orders: [], openAlertCount: 2 },
      error: null,
      traceId: "trace-map"
    });
    expect(response.headers.get("X-Trace-Id")).toBe(body.traceId);
  });
});

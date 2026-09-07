import { describe, expect, it, vi } from "vitest";

import {
  DRIVER_LOCATION_INTERVAL_MS,
  DRIVER_READ_INTERVAL_MS,
  endDriverShift,
  ensureDriverShiftStarted,
  fetchDriverWorkspace,
  runDriverTaskAction,
  reportDriverLocation
} from "./driver-h5-entry";

describe("driver H5 E2E entry", () => {
  it("starts the current driver's shift through the authenticated V2 route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await ensureDriverShiftStarted(fetchMock);

    expect(fetchMock).toHaveBeenCalledWith("/api/v2/driver/shift/start", {
      method: "POST"
    });
  });

  it("uploads one current sample through the frozen V2 batch payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          results: [{ index: 0, status: "success" }],
          success: 1,
          skipped: 0
        }
      })
    });
    const sample = {
      lat: 31.230416,
      lng: 121.473701,
      accuracyMeters: 12,
      capturedAt: "2026-08-09T10:00:00.000Z"
    };

    await expect(reportDriverLocation(sample, fetchMock)).resolves.toEqual({
      index: 0,
      status: "success"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v2/driver/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples: [sample] })
    });
  });

  it("returns a skipped sample when the location endpoint rejects it with HTTP 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          results: [
            { index: 0, status: "skipped", reason: "ACCURACY_TOO_LOW" }
          ],
          success: 0,
          skipped: 1
        }
      })
    });

    await expect(
      reportDriverLocation(
        {
          lat: 31.230416,
          lng: 121.473701,
          accuracyMeters: 120,
          capturedAt: "2026-08-09T10:00:00.000Z"
        },
        fetchMock
      )
    ).resolves.toEqual({
      index: 0,
      status: "skipped",
      reason: "ACCURACY_TOO_LOW"
    });
  });

  it("fails closed when automatic shift start is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(ensureDriverShiftStarted(fetchMock)).rejects.toThrow(
      "SHIFT_START_HTTP_401"
    );
  });

  it("reads the frozen three-endpoint workspace without carrying driverId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ id: "driver-1" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ id: "assignment-1" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ orderId: "order-1" }] })
      });

    const result = await fetchDriverWorkspace(fetchMock);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v2/driver/map",
      "/api/v2/driver/tasks",
      "/api/v2/driver/orders/unassigned"
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("driverId");
    expect(result).toEqual({
      drivers: [{ id: "driver-1" }],
      tasks: [{ id: "assignment-1" }],
      unassignedOrders: [{ orderId: "order-1" }]
    });
  });

  it("uses the frozen polling and location intervals", () => {
    expect(DRIVER_READ_INTERVAL_MS).toBe(15_000);
    expect(DRIVER_LOCATION_INTERVAL_MS).toBe(30_000);
  });

  it("uses only V2 execution actions and shift end", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} })
    });

    await runDriverTaskAction("assignment-1", "depart", fetchMock);
    await endDriverShift(fetchMock);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v2/driver/tasks/assignment-1/depart",
      { method: "POST" }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v2/driver/shift/end", {
      method: "POST"
    });
  });
});

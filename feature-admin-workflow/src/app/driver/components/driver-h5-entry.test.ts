import { describe, expect, it, vi } from "vitest";

import {
  ensureDriverShiftStarted,
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const sample = {
      lat: 31.230416,
      lng: 121.473701,
      accuracyMeters: 12,
      capturedAt: "2026-08-09T10:00:00.000Z"
    };

    await reportDriverLocation(sample, fetchMock);

    expect(fetchMock).toHaveBeenCalledWith("/api/v2/driver/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples: [sample] })
    });
  });

  it("fails closed when automatic shift start is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(ensureDriverShiftStarted(fetchMock)).rejects.toThrow(
      "SHIFT_START_HTTP_401"
    );
  });
});

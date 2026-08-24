import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRIVER_LOCATION_INTERVAL_MS } from "./driver-h5-entry";
import {
  DriverGpsStatus,
  GPS_TIMESTAMP_CLASS,
  getLocationReportView,
  startDriverGpsSampling
} from "./driver-gps-tracker";

vi.stubGlobal("React", React);

function position(timestamp: number, lat: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: 121.473701,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({})
    },
    timestamp,
    toJSON: () => ({})
  } as GeolocationPosition;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("driver GPS sampling", () => {
  it("shows success only for accepted samples and explains every skipped reason", () => {
    expect(getLocationReportView({ index: 0, status: "success" }).label).toBe(
      "位置上报正常"
    );
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "ACCURACY_TOO_LOW"
      }).label
    ).toBe("定位精度不足，位置未接收");
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "CLOCK_SKEW"
      }).label
    ).toBe("设备时间异常，位置未接收");
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "EXPIRED_AT_RECEIPT"
      }).label
    ).toBe("定位样本已过期，位置未接收");
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "INVALID_SAMPLE"
      }).label
    ).toBe("定位数据无效，位置未接收");
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "DUPLICATE"
      }).label
    ).toBe("定位样本重复，位置未更新");
  });

  it("announces only the GPS status and keeps the periodic timestamp outside the live region", () => {
    const html = renderToStaticMarkup(
      <DriverGpsStatus
        view={{ dot: "bg-[var(--success)]", label: "位置上报正常" }}
        lastReportedAt={new Date("2026-08-24T08:00:00.000Z")}
      />
    );

    const liveRegionStart = html.indexOf('role="status"');
    const timestampStart = html.indexOf(`class="${GPS_TIMESTAMP_CLASS}"`);
    const liveRegionEnd = html.lastIndexOf("</span>", timestampStart);

    expect(liveRegionStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(liveRegionEnd).toBeGreaterThan(liveRegionStart);
    expect(liveRegionEnd).toBeLessThan(timestampStart);
  });

  it("uses existing semantic tokens for GPS status colors", () => {
    expect(getLocationReportView({ index: 0, status: "success" }).dot).toBe(
      "bg-[var(--success)]"
    );
    expect(
      getLocationReportView({
        index: 0,
        status: "skipped",
        reason: "ACCURACY_TOO_LOW"
      }).dot
    ).toBe("bg-[var(--warning)]");
    expect(GPS_TIMESTAMP_CLASS).toContain("text-[var(--text-secondary)]");

    const source = readFileSync(
      new URL("./driver-gps-tracker.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring|accent)-(?:slate|blue|amber|emerald|rose|white|black)(?:-\d+|\/\d+)?\b/
    );
  });

  it("requests a fresh position every interval and preserves each browser timestamp", async () => {
    vi.useFakeTimers();
    const callbacks: PositionCallback[] = [];
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      callbacks.push(success);
    });
    const samples: Array<{ capturedAt: string }> = [];
    const stop = startDriverGpsSampling({
      geolocation: { getCurrentPosition } as unknown as Geolocation,
      onSample: (sample) => samples.push(sample),
      onError: vi.fn()
    });

    expect(getCurrentPosition).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ maximumAge: 0 })
    );
    callbacks[0](position(Date.parse("2026-08-17T08:00:00.000Z"), 31.230416));

    await vi.advanceTimersByTimeAsync(DRIVER_LOCATION_INTERVAL_MS);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    callbacks[1](position(Date.parse("2026-08-17T08:00:30.000Z"), 31.230417));

    expect(samples.map((sample) => sample.capturedAt)).toEqual([
      "2026-08-17T08:00:00.000Z",
      "2026-08-17T08:00:30.000Z"
    ]);

    stop();
    await vi.advanceTimersByTimeAsync(DRIVER_LOCATION_INTERVAL_MS);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("ignores an in-flight location result after reporting is stopped", () => {
    vi.useFakeTimers();
    const callbacks: PositionCallback[] = [];
    const samples: Array<{ capturedAt: string }> = [];
    const stop = startDriverGpsSampling({
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          callbacks.push(success);
        })
      } as unknown as Geolocation,
      onSample: (sample) => samples.push(sample),
      onError: vi.fn()
    });

    stop();
    callbacks[0](position(Date.parse("2026-08-17T08:01:00.000Z"), 31.230418));

    expect(samples).toEqual([]);
  });
});

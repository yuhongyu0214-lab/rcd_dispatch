"use client";

import { useEffect, useRef, useState } from "react";

import type {
  LocationRejectionReasonV2,
  LocationSampleResultV2
} from "@/types/v2";

import {
  DRIVER_LOCATION_INTERVAL_MS,
  ensureDriverShiftStarted,
  reportDriverLocation,
  type DriverLocationSample
} from "./driver-h5-entry";

type GpsStatus = "starting" | "active" | "degraded" | "denied";
type GpsStatusView = { dot: string; label: string };

const STATUS_VIEW: Record<GpsStatus, GpsStatusView> = {
  starting: { dot: "bg-slate-300", label: "定位启动中" },
  active: { dot: "bg-emerald-500", label: "位置上报正常" },
  degraded: { dot: "bg-amber-400", label: "位置上报异常" },
  denied: { dot: "bg-rose-500", label: "请开启定位权限" }
};

const LOCATION_REJECTION_VIEW: Record<
  LocationRejectionReasonV2,
  GpsStatusView
> = {
  ACCURACY_TOO_LOW: {
    dot: "bg-amber-500",
    label: "定位精度不足，位置未接收"
  },
  CLOCK_SKEW: {
    dot: "bg-amber-500",
    label: "设备时间异常，位置未接收"
  },
  EXPIRED_AT_RECEIPT: {
    dot: "bg-amber-500",
    label: "定位样本已过期，位置未接收"
  },
  INVALID_SAMPLE: {
    dot: "bg-amber-500",
    label: "定位数据无效，位置未接收"
  },
  DUPLICATE: {
    dot: "bg-amber-500",
    label: "定位样本重复，位置未更新"
  }
};

const STOPPED_VIEW = { dot: "bg-slate-300", label: "定位已停止" };

export const GPS_TIMESTAMP_CLASS = "shrink-0 text-slate-600";

export function getLocationReportView(
  result: LocationSampleResultV2
): GpsStatusView {
  return result.status === "success"
    ? STATUS_VIEW.active
    : LOCATION_REJECTION_VIEW[result.reason];
}

const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 30_000,
  maximumAge: 0
};

export function startDriverGpsSampling({
  geolocation,
  onSample,
  onError
}: {
  geolocation: Geolocation;
  onSample(sample: DriverLocationSample): void | Promise<void>;
  onError(error: GeolocationPositionError): void;
}) {
  let stopped = false;
  let requestInFlight = false;

  const requestPosition = () => {
    if (stopped || requestInFlight) return;
    requestInFlight = true;
    geolocation.getCurrentPosition(
      (position) => {
        requestInFlight = false;
        if (stopped) return;
        void onSample({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString()
        });
      },
      (error) => {
        requestInFlight = false;
        if (!stopped) onError(error);
      },
      POSITION_OPTIONS
    );
  };

  requestPosition();
  const timer = setInterval(requestPosition, DRIVER_LOCATION_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function DriverGpsTracker({
  driverId,
  enabled = true
}: {
  driverId: string;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<GpsStatus>("starting");
  const [locationReportView, setLocationReportView] =
    useState<GpsStatusView | null>(null);
  const [lastReportedAt, setLastReportedAt] = useState<Date | null>(null);
  const reporting = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stopSampling: (() => void) | null = null;

    async function report(sample: DriverLocationSample) {
      if (reporting.current) return;
      reporting.current = true;
      try {
        const result = await reportDriverLocation(sample);
        if (!cancelled) {
          setLocationReportView(getLocationReportView(result));
          if (result.status === "success") {
            setLastReportedAt(new Date());
            setStatus("active");
          } else {
            setStatus("degraded");
          }
        }
      } catch {
        if (!cancelled) {
          setLocationReportView(null);
          setStatus("degraded");
        }
      } finally {
        reporting.current = false;
      }
    }

    void ensureDriverShiftStarted()
      .then(() => {
        if (cancelled) return;
        if (!navigator.geolocation) {
          setLocationReportView(null);
          setStatus("degraded");
          return;
        }
        stopSampling = startDriverGpsSampling({
          geolocation: navigator.geolocation,
          onSample: report,
          onError: (error) => {
            if (cancelled) return;
            setLocationReportView(null);
            setStatus(
              error.code === error.PERMISSION_DENIED ? "denied" : "degraded"
            );
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLocationReportView(null);
          setStatus("degraded");
        }
      });

    return () => {
      cancelled = true;
      stopSampling?.();
    };
  }, [driverId, enabled]);

  const view = enabled
    ? (locationReportView ?? STATUS_VIEW[status])
    : STOPPED_VIEW;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${view.dot}`} />
      <span className="truncate">{view.label}</span>
      {lastReportedAt ? (
        <span className={GPS_TIMESTAMP_CLASS}>
          {lastReportedAt.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </span>
      ) : null}
    </div>
  );
}

import type { DriverStatus } from "@prisma/client";

import { dispatchLog } from "./log";
import type { DispatchCandidate, DispatchCoordinate, EtaResult } from "./types";

const AMAP_DRIVING_URL = "https://restapi.amap.com/v3/direction/driving";
const AMAP_DRIVING_TIMEOUT_MS = 5000;
const ETA_FAILURE_MINUTES = 9999;

const fallbackEtaByStatus: Record<DriverStatus, number> = {
  S1: 18,
  S2: 28,
  S3: 42,
  S4: 58,
  OFFLINE: ETA_FAILURE_MINUTES,
  UNAVAILABLE: ETA_FAILURE_MINUTES
};

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}

function getStableJitter(value: string) {
  return value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9;
}

function estimateFallbackEtaMinutes(candidate: DispatchCandidate) {
  return fallbackEtaByStatus[candidate.driverStatus] + getStableJitter(candidate.driverId);
}

function formatAmapLocation(coordinate: DispatchCoordinate) {
  return `${coordinate.lng},${coordinate.lat}`;
}

async function fetchAmapEtaMinutes(input: {
  candidate: DispatchCandidate;
  destination: DispatchCoordinate;
  traceId?: string;
}): Promise<number> {
  const amapKey = process.env.AMAP_SERVER_KEY;

  if (!amapKey || !input.candidate.origin) {
    dispatchLog.warn({
      traceId: input.traceId ?? null,
      driverId: input.candidate.driverId,
      reason: !amapKey ? "AMAP_KEY_MISSING" : "ORIGIN_MISSING"
    }, "dispatch_eta_degraded");
    return ETA_FAILURE_MINUTES;
  }

  const { signal, cleanup } = withTimeoutSignal(AMAP_DRIVING_TIMEOUT_MS);
  const url = new URL(AMAP_DRIVING_URL);
  url.searchParams.set("key", amapKey);
  url.searchParams.set("origin", formatAmapLocation(input.candidate.origin));
  url.searchParams.set("destination", formatAmapLocation(input.destination));

  try {
    const response = await fetch(url, {
      method: "GET",
      signal,
      cache: "no-store"
    });

    if (!response.ok) {
      dispatchLog.warn({
        traceId: input.traceId ?? null,
        driverId: input.candidate.driverId,
        reason: `AMAP_HTTP_${response.status}`
      }, "dispatch_eta_degraded");
      return ETA_FAILURE_MINUTES;
    }

    const payload = (await response.json()) as {
      status?: string;
      route?: {
        paths?: Array<{
          duration?: string;
        }>;
      };
    };
    const durationSeconds = Number(payload.route?.paths?.[0]?.duration);

    if (payload.status !== "1" || !Number.isFinite(durationSeconds)) {
      dispatchLog.warn({
        traceId: input.traceId ?? null,
        driverId: input.candidate.driverId,
        reason: "AMAP_PAYLOAD_INVALID"
      }, "dispatch_eta_degraded");
      return ETA_FAILURE_MINUTES;
    }

    return Math.ceil(durationSeconds / 60);
  } catch {
    dispatchLog.warn({
      traceId: input.traceId ?? null,
      driverId: input.candidate.driverId,
      reason: "AMAP_REQUEST_FAILED"
    }, "dispatch_eta_degraded");
    return ETA_FAILURE_MINUTES;
  } finally {
    cleanup();
  }
}

export async function getEtaResults(input: {
  candidates: DispatchCandidate[];
  destination: DispatchCoordinate | null;
  traceId?: string;
}): Promise<EtaResult[]> {
  if (!input.destination) {
    return input.candidates.map((candidate) => ({
      driverId: candidate.driverId,
      etaMinutes: estimateFallbackEtaMinutes(candidate)
    }));
  }

  return Promise.all(
    input.candidates.map(async (candidate) => ({
      driverId: candidate.driverId,
      etaMinutes: await fetchAmapEtaMinutes({
        candidate,
        destination: input.destination as DispatchCoordinate,
        traceId: input.traceId
      })
    }))
  );
}

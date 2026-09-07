import type { DriverOrderMarkerViewV2 } from "@/lib/driver-v2/types";
import type {
  DriverTaskV2,
  DriverV2,
  LocationBatchResultV2,
  LocationRejectionReasonV2,
  LocationSampleResultV2,
  ServiceModuleV2
} from "@/types/v2";

export type DriverLocationSample = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: string;
};

export type DriverWorkspaceData = {
  drivers: DriverV2[];
  tasks: DriverTaskV2[];
  unassignedOrders: DriverOrderMarkerViewV2[];
};

export const DRIVER_READ_INTERVAL_MS = 15_000;
export const DRIVER_LOCATION_INTERVAL_MS = 30_000;

const LOCATION_REJECTION_REASONS: ReadonlySet<LocationRejectionReasonV2> =
  new Set([
    "ACCURACY_TOO_LOW",
    "CLOCK_SKEW",
    "EXPIRED_AT_RECEIPT",
    "INVALID_SAMPLE",
    "DUPLICATE"
  ]);

type FetchLike = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json">>;

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { message?: string };
};

async function readData<T>(
  url: string,
  errorCode: string,
  fetchImpl: FetchLike
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store"
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success || body.data === undefined) {
    throw new Error(`${errorCode}_HTTP_${response.status}`);
  }
  return body.data;
}

export async function ensureDriverShiftStarted(fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl("/api/v2/driver/shift/start", {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`SHIFT_START_HTTP_${response.status}`);
  }
}

export async function reportDriverLocation(
  sample: DriverLocationSample,
  fetchImpl: FetchLike = fetch
): Promise<LocationSampleResultV2> {
  const response = await fetchImpl("/api/v2/driver/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ samples: [sample] })
  });

  if (!response.ok) {
    throw new Error(`LOCATION_HTTP_${response.status}`);
  }

  const body = (await response.json()) as ApiEnvelope<LocationBatchResultV2>;
  const result = body.data?.results[0];
  if (body.success && result?.status === "success") return result;
  if (
    body.success &&
    result?.status === "skipped" &&
    LOCATION_REJECTION_REASONS.has(result.reason)
  ) {
    return result;
  }
  throw new Error("LOCATION_RESPONSE_INVALID");
}

export async function fetchDriverWorkspace(
  fetchImpl: FetchLike = fetch
): Promise<DriverWorkspaceData> {
  const [drivers, tasks, unassignedOrders] = await Promise.all([
    readData<DriverV2[]>("/api/v2/driver/map", "DRIVER_MAP", fetchImpl),
    readData<DriverTaskV2[]>("/api/v2/driver/tasks", "DRIVER_TASKS", fetchImpl),
    readData<DriverOrderMarkerViewV2[]>(
      "/api/v2/driver/orders/unassigned",
      "DRIVER_UNASSIGNED",
      fetchImpl
    )
  ]);

  return { drivers, tasks, unassignedOrders };
}

export async function runDriverTaskAction(
  assignmentId: string,
  action: "depart" | "arrive" | "complete",
  fetchImpl: FetchLike = fetch
) {
  const response = await fetchImpl(
    `/api/v2/driver/tasks/${encodeURIComponent(assignmentId)}/${action}`,
    { method: "POST" }
  );
  if (!response.ok) {
    throw new Error(
      `DRIVER_TASK_${action.toUpperCase()}_HTTP_${response.status}`
    );
  }
}

export async function updateDriverTaskModules(
  assignmentId: string,
  modules: ServiceModuleV2[],
  fetchImpl: FetchLike = fetch
) {
  const response = await fetchImpl(
    `/api/v2/driver/tasks/${encodeURIComponent(assignmentId)}/modules`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modules })
    }
  );
  if (!response.ok) {
    throw new Error(`DRIVER_TASK_MODULES_HTTP_${response.status}`);
  }
}

export async function endDriverShift(fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl("/api/v2/driver/shift/end", {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`SHIFT_END_HTTP_${response.status}`);
  }
}

export type DriverLocationSample = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: string;
};

type FetchLike = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, "ok" | "status">>;

export async function ensureDriverShiftStarted(
  fetchImpl: FetchLike = fetch
) {
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
) {
  const response = await fetchImpl("/api/v2/driver/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ samples: [sample] })
  });

  if (!response.ok) {
    throw new Error(`LOCATION_HTTP_${response.status}`);
  }
}

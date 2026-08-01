import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amapHealthCheck, drivingRoute } from "./amap";

function amapResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as Response;
}

describe("Amap driving route failures", () => {
  beforeEach(() => {
    vi.stubEnv("AMAP_SERVER_KEY", "gate3-test-key");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns a real route duration from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      amapResponse({
        status: "1",
        infocode: "10000",
        route: {
          paths: [
            {
              distance: "1234",
              duration: "321",
              steps: []
            }
          ]
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      drivingRoute(
        { lat: 31.2304, lng: 121.4737 },
        { lat: 31.2202, lng: 121.4557 }
      )
    ).resolves.toMatchObject({
      distance: 1234,
      duration: 321
    });
  });

  it("rejects an empty path response instead of inventing an ETA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        amapResponse({
          status: "1",
          infocode: "10000",
          route: { paths: [] }
        })
      )
    );

    await expect(
      drivingRoute(
        { lat: 31.2304, lng: 121.4737 },
        { lat: 31.2202, lng: 121.4557 }
      )
    ).rejects.toThrow("AMAP_NO_ROUTE_FOUND");
  });

  it("fails quota errors immediately without retrying or inventing an ETA", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      amapResponse({
        status: "0",
        infocode: "10003",
        info: "DAILY_QUERY_OVER_LIMIT"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      drivingRoute(
        { lat: 31.2304, lng: 121.4737 },
        { lat: 31.2202, lng: 121.4557 }
      )
    ).rejects.toThrow("AMAP_API_ERROR_10003");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout after bounded retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    const result = drivingRoute(
      { lat: 31.2304, lng: 121.4737 },
      { lat: 31.2202, lng: 121.4557 }
    );
    const assertion = expect(result).rejects.toThrow("AMAP_TIMEOUT");

    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Amap readiness probe", () => {
  beforeEach(() => {
    vi.stubEnv("AMAP_SERVER_KEY", "gate3-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the official IP endpoint without planning a route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      amapResponse({ status: "1", infocode: "10000" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(amapHealthCheck()).resolves.toBe(true);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe("/v3/ip");
    expect(url.searchParams.get("ip")).toBe("114.247.50.2");
    expect(url.searchParams.get("key")).toBe("gate3-test-key");
    expect(requestInit).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("fails closed when the key is missing or the API rejects it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      amapResponse({ status: "0", infocode: "10003" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(amapHealthCheck()).resolves.toBe(false);

    vi.stubEnv("AMAP_SERVER_KEY", "");
    await expect(amapHealthCheck()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

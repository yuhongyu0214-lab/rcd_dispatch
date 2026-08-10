import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAmapRateLimiterForTests,
  amapHealthCheck,
  drivingRoute
} from "./amap";
import { geocodeAddress } from "./import/services/geocode";

function amapResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as Response;
}

describe("Amap driving route failures", () => {
  beforeEach(() => {
    __resetAmapRateLimiterForTests();
    vi.stubEnv("AMAP_SERVER_KEY", "gate3-test-key");
  });

  afterEach(() => {
    __resetAmapRateLimiterForTests();
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

  it("retries transient QPS errors through the same bounded request path", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        amapResponse({
          status: "0",
          infocode: "10021",
          info: "USER_QPS_OVER_LIMIT"
        })
      )
      .mockResolvedValueOnce(
        amapResponse({
          status: "1",
          infocode: "10000",
          route: {
            paths: [{ distance: "1234", duration: "321", steps: [] }]
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = drivingRoute(
      { lat: 31.2304, lng: 121.4737 },
      { lat: 31.2202, lng: 121.4557 }
    );

    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ duration: 321 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts no more than three real HTTP attempts in any second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
    const startedAt: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      startedAt.push(Date.now());
      return amapResponse({
        status: "1",
        infocode: "10000",
        route: {
          paths: [{ distance: "1234", duration: "321", steps: [] }]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const routes = Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        drivingRoute(
          { lat: 31.2304 + index * 0.001, lng: 121.4737 },
          { lat: 31.2202, lng: 121.4557 + index * 0.001 }
        )
      )
    );

    await vi.advanceTimersByTimeAsync(1_002);
    await routes;

    expect(startedAt).toHaveLength(4);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(334);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(334);
    expect(startedAt[3] - startedAt[2]).toBeGreaterThanOrEqual(334);
  });

  it("shares the same request budget with order-ingest geocoding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
    const startedAt: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async (requestUrl: URL) => {
      startedAt.push(Date.now());
      const url = new URL(String(requestUrl));
      if (url.pathname === "/v3/geocode/geo") {
        return amapResponse({
          status: "1",
          infocode: "10000",
          geocodes: [{ location: "121.4737,31.2304", city: "上海市" }]
        });
      }
      return amapResponse({
        status: "1",
        infocode: "10000",
        route: {
          paths: [{ distance: "1234", duration: "321", steps: [] }]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const requests = Promise.all([
      drivingRoute(
        { lat: 31.2304, lng: 121.4737 },
        { lat: 31.2202, lng: 121.4557 }
      ),
      geocodeAddress("上海市黄浦区人民大道200号", "取车地址", "上海市"),
      drivingRoute(
        { lat: 31.2202, lng: 121.4557 },
        { lat: 31.2304, lng: 121.4737 }
      ),
      geocodeAddress("上海市静安区南京西路", "还车地址", "上海市")
    ]);

    await vi.advanceTimersByTimeAsync(1_002);
    await requests;

    expect(startedAt).toHaveLength(4);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(334);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(334);
    expect(startedAt[3] - startedAt[2]).toBeGreaterThanOrEqual(334);
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
    __resetAmapRateLimiterForTests();
    vi.stubEnv("AMAP_SERVER_KEY", "gate3-test-key");
  });

  afterEach(() => {
    __resetAmapRateLimiterForTests();
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

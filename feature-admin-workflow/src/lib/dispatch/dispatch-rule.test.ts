import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyDispatchConstraints } from "./constraints";
import { getEtaResults } from "./eta";
import { filterDispatchCandidates } from "./filter";
import { rankDispatchCandidates } from "./sort";
import type { DispatchCandidate } from "./types";

// Mock Redis — use vi.hoisted() so mock fns are available when factory runs at hoist time
const { mockIsDriverOnline, mockGetCachedEta, mockCacheEta } = vi.hoisted(() => ({
  mockIsDriverOnline: vi.fn().mockResolvedValue(true),
  mockGetCachedEta: vi.fn().mockResolvedValue(null),
  mockCacheEta: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/lib/redis", () => ({
  isRedisAvailable: vi.fn().mockReturnValue(false),
  isDriverOnline: mockIsDriverOnline,
  getCachedEta: mockGetCachedEta,
  cacheEta: mockCacheEta,
  acquireDispatchLock: vi.fn().mockResolvedValue(true),
  releaseDispatchLock: vi.fn().mockResolvedValue(undefined),
  setDriverOnline: vi.fn(),
  getDriverLocation: vi.fn(),
  getCachedMapSnapshot: vi.fn(),
  redisHealthCheck: vi.fn()
}));

const baseCandidate: DispatchCandidate = {
  activeOrders: { door: 0, store: 0 },
  driverId: "driver-s1",
  driverName: "李强",
  phone: "13800138001",
  driverStatus: "S1",
  origin: { lat: 31.1977, lng: 121.3275 },
  storeId: "store-sh",
  storeName: "上海虹桥店",
  distanceKm: 3.2
};

describe("dispatch-rule-v1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDriverOnline.mockResolvedValue(true);
    mockGetCachedEta.mockResolvedValue(null);
    mockCacheEta.mockResolvedValue(undefined);
  });

  it("filters out unavailable drivers and door-order occupied drivers", async () => {
    const { candidates } = await filterDispatchCandidates({
      orderType: "DOOR_DELIVERY",
      orderStoreId: "store-sh",
      orderLat: 31.1942,
      orderLng: 121.3268,
      originsByDriverId: new Map([
        ["driver-s1", { lat: 31.1977, lng: 121.3275 }],
        ["driver-unavailable", null],
        ["driver-door-busy", { lat: 31.1977, lng: 121.3275 }]
      ]),
      drivers: [
        {
          assignments: [],
          id: "driver-s1",
          name: "李强",
          phone: "13800138001",
          status: "S1",
          storeId: "store-sh",
          lastLat: 31.1977,
          lastLng: 121.3275,
          store: { id: "store-sh", name: "上海虹桥店" }
        },
        {
          assignments: [],
          id: "driver-unavailable",
          name: "赵伟",
          phone: "13800138002",
          status: "UNAVAILABLE",
          storeId: "store-sh",
          lastLat: null,
          lastLng: null,
          store: { id: "store-sh", name: "上海虹桥店" }
        },
        {
          assignments: [{ status: "ACTIVE" as const, order: { type: "DOOR_PICKUP" as const } }],
          id: "driver-door-busy",
          name: "周敏",
          phone: "13800138003",
          status: "S4",
          storeId: "store-sh",
          lastLat: 31.1977,
          lastLng: 121.3275,
          store: { id: "store-sh", name: "上海虹桥店" }
        }
      ]
    });

    // driver-unavailable is filtered by status (UNAVAILABLE)
    // driver-door-busy is filtered by active assignment conflict + door order limit
    // driver-s1 passes all checks (online=true, no active assignment, same store, within distance)
    expect(candidates.map((candidate) => candidate.driverId)).toEqual(["driver-s1"]);
  });

  it("ranks store-order candidates by status, ETA, and load penalty", () => {
    const topN = rankDispatchCandidates({
      candidates: [
        {
          ...baseCandidate,
          activeOrders: { door: 0, store: 2 },
          driverId: "driver-s1-busy",
          driverStatus: "S1",
          distanceKm: 3.2
        },
        {
          ...baseCandidate,
          activeOrders: { door: 0, store: 0 },
          driverId: "driver-s1-idle",
          driverName: "周敏",
          driverStatus: "S1",
          distanceKm: 4.1
        },
        {
          ...baseCandidate,
          driverId: "driver-s2",
          driverName: "王磊",
          driverStatus: "S2",
          distanceKm: 5.0
        }
      ],
      etaResults: [
        { driverId: "driver-s1-busy", etaMinutes: 12, distanceMeters: 3200, durationSeconds: 720, etaStatus: "NORMAL" },
        { driverId: "driver-s1-idle", etaMinutes: 16, distanceMeters: 4100, durationSeconds: 960, etaStatus: "NORMAL" },
        { driverId: "driver-s2", etaMinutes: 8, distanceMeters: 5000, durationSeconds: 480, etaStatus: "NORMAL" }
      ],
      orderType: "STORE_PICKUP",
      orderStoreId: "store-sh",
      topNLimit: 3
    });

    // driver-s1-idle should rank first: same store bonus, no load penalty
    // driver-s1-busy has loadPenalty=14 (2 store orders * 7 min) which outweighs 4-min ETA advantage
    // driver-s2 has lower priority (S2 = 2*10000 vs S1 = 1*10000)
    expect(topN[0].driverId).toBe("driver-s1-idle");
    // driver-s1-busy should have load penalty and rank second
    expect(topN[1].loadPenaltyMinutes).toBe(14);
    // Check reasons array exists with store match
    expect(topN[0].reasons.length).toBeGreaterThan(0);
    expect(topN[0].reasons).toContain("同门店");
  });

  it("returns manual outcome when the best ETA reaches threshold", () => {
    const result = applyDispatchConstraints({
      orderId: "order-1",
      orderNo: "D3832",
      orderType: "STORE_PICKUP",
      topN: [
        {
          ...baseCandidate,
          phone: "13800138001",
          etaMinutes: 120,
          etaStatus: "EXCEEDED",
          distanceKm: 50.0,
          activeDoorOrders: 0,
          activeStoreOrders: 0,
          loadPenaltyMinutes: 0,
          priorityRank: 1,
          reasons: ["预计到达超过2小时，建议人工判断"],
          score: 10120
        }
      ]
    });

    expect(result.outcome).toBe("MANUAL");
    expect(result.reason).toBe("ETA_EXCEEDED");
  });

  it("keeps the order pending when there is no available driver", () => {
    const result = applyDispatchConstraints({
      orderId: "order-1",
      orderNo: "D3832",
      orderType: "STORE_PICKUP",
      topN: []
    });

    expect(result.outcome).toBe("PENDING");
    expect(result.reason).toBe("NO_DRIVER");
    expect(result.topN).toEqual([]);
  });

  it("degrades failed AMap ETA with fallback and FALLBACK status without throwing", async () => {
    const originalKey = process.env.AMAP_SERVER_KEY;
    process.env.AMAP_SERVER_KEY = "test-key";

    // Return HTTP 400 (non-retryable HTTP error — avoids amap retry/backoff)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400
      })
    );

    const result = await getEtaResults({
      orderId: "order-test",
      candidates: [
        {
          driverId: "driver-s1",
          driverStatus: "S1",
          origin: { lat: 31.1977, lng: 121.3275 }
        }
      ],
      destination: { lat: 31.1942, lng: 121.3268 },
      traceId: "trace-test"
    });

    // Fallback ETA is status-based (S1 ≈ 18 + jitter), not 9999
    // etaStatus should be FALLBACK to indicate AMap failure
    expect(result[0].driverId).toBe("driver-s1");
    expect(result[0].etaStatus).toBe("FALLBACK");
    expect(result[0].etaMinutes).toBeGreaterThan(0);
    expect(result[0].etaMinutes).toBeLessThan(40); // S1 fallback is typically 18-27

    process.env.AMAP_SERVER_KEY = originalKey;
    vi.unstubAllGlobals();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

import type { GeoPointV2 } from "@/types/v2";
import type {
  DispatchInputV2,
  DispatchDriverInputV2,
  DispatchOrderInputV2
} from "@/types/v2/dispatch";
import type { EtaResolver } from "../core/types";
import type { EtaCacheValueV2 } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before the module-level vi.mock calls.
// ---------------------------------------------------------------------------

const { mockDrivingRoute, mockGetCachedEtaV2, mockCacheEtaV2 } = vi.hoisted(
  () => ({
    mockDrivingRoute: vi.fn(),
    mockGetCachedEtaV2: vi.fn(),
    mockCacheEtaV2: vi.fn()
  })
);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/amap", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/amap")>("@/lib/amap");
  return {
    ...actual,
    drivingRoute: mockDrivingRoute
  };
});

vi.mock("@/lib/redis", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/redis")>("@/lib/redis");
  return {
    ...actual,
    getCachedEtaV2: mockGetCachedEtaV2,
    cacheEtaV2: mockCacheEtaV2
  };
});

import { buildEtaMatrix } from "./eta-matrix-service";
import { runDispatchV2 } from "../core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

function gp(lat: number, lng: number): GeoPointV2 {
  return { lat, lng };
}

function makeDriver(
  overrides: Partial<DispatchDriverInputV2> = {}
): DispatchDriverInputV2 {
  return {
    driverId: "d1",
    storeCode: "STORE-A",
    onShift: true,
    availability: "AVAILABLE",
    planVersion: 1,
    locationFreshness: "FRESH",
    lastLocation: {
      lat: 30.28,
      lng: 120.16,
      accuracyMeters: 10,
      capturedAt: new Date(NOW).toISOString()
    },
    assignments: [],
    ...overrides
  };
}

function makeOrder(
  overrides: Partial<DispatchOrderInputV2> = {}
): DispatchOrderInputV2 {
  return {
    orderId: "o1",
    orderNo: "ORD-001",
    businessType: "STORE_PICKUP",
    executionStatus: "UNASSIGNED",
    feasibility: "UNKNOWN",
    slackMinutes: null,
    promisedPickupAt: "2026-07-19T09:00:00.000Z",
    pickupAddress: "123 Main St",
    pickupLocation: gp(30.2741, 120.1551),
    deliveryAddress: "456 Oak Ave",
    deliveryLocation: gp(30.32, 120.143),
    storeCode: "STORE-A",
    serviceModuleMinutes: 0,
    ...overrides
  };
}

function makeCacheValue(etaMinutes: number): EtaCacheValueV2 {
  return {
    etaMinutes,
    distanceMeters: 5000,
    durationSeconds: etaMinutes * 60,
    cachedAt: NOW - 10_000 // 10 s ago — fresh
  };
}

const BASE_EVENT = {
  type: "ORDER_RECEIVED" as const,
  occurredAt: new Date(NOW).toISOString(),
  orderId: "o1"
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no cache hits, drivingRoute returns 15 min.
  mockGetCachedEtaV2.mockResolvedValue(null);
  mockDrivingRoute.mockResolvedValue({ distance: 5000, duration: 900 });
  mockCacheEtaV2.mockResolvedValue(undefined);
});

// ===========================================================================
// 1. Empty input
// ===========================================================================

describe("empty input", () => {
  it("no orders or drivers → resolver always returns null", async () => {
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [],
      drivers: []
    };

    const resolver = await buildEtaMatrix(input);
    expect(resolver(gp(30, 120), gp(31, 121))).toBeNull();
    expect(mockGetCachedEtaV2).not.toHaveBeenCalled();
    expect(mockDrivingRoute).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. No locations
// ===========================================================================

describe("no locations", () => {
  it("driver without lastLocation + order without coordinates → no pairs, no Amap call", async () => {
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [
        makeOrder({
          pickupLocation: undefined,
          deliveryLocation: undefined
        })
      ],
      drivers: [makeDriver({ lastLocation: undefined })]
    };

    const resolver = await buildEtaMatrix(input);
    expect(resolver(gp(30, 120), gp(31, 121))).toBeNull();
    expect(mockDrivingRoute).not.toHaveBeenCalled();
  });

  it("driver has location but order has no pickup → no deadhead pairs", async () => {
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [
        makeOrder({ pickupLocation: undefined, deliveryLocation: gp(30, 121) })
      ],
      drivers: [makeDriver()]
    };

    // Only service pairs: pickup→delivery. But pickup is undefined, so no pairs.
    await buildEtaMatrix(input);
    expect(mockGetCachedEtaV2).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. Cache hits
// ===========================================================================

describe("cache hits", () => {
  it("all pairs hit Redis cache → no Amap calls", async () => {
    mockGetCachedEtaV2.mockResolvedValue(makeCacheValue(12));

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // Resolver returns cached value.
    const eta = resolver(gp(30.28, 120.16), gp(30.2741, 120.1551));
    expect(eta).toBe(12);

    // Amap was never called.
    expect(mockDrivingRoute).not.toHaveBeenCalled();
    // Redis cache was NOT written again (already cached).
    expect(mockCacheEtaV2).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Cache misses → Amap
// ===========================================================================

describe("cache misses", () => {
  it("all pairs miss cache → Amap called, resolver returns Amap values", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null); // all misses
    mockDrivingRoute.mockResolvedValue({ distance: 8000, duration: 1200 }); // 20 min

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // Deadhead pair: driver→pickup
    const eta = resolver(gp(30.28, 120.16), gp(30.2741, 120.1551));
    expect(eta).toBe(20); // 1200s / 60 = 20 min

    expect(mockDrivingRoute).toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. Partial cache hit/miss
// ===========================================================================

describe("partial cache hit/miss", () => {
  it("cache hits skip Amap, cache misses trigger Amap", async () => {
    // 1 driver + 1 order = 3 pairs:
    //   (1) deadhead: driver→pickup
    //   (2) deadhead: delivery→pickup
    //   (3) service:  pickup→delivery
    // First pair hits cache, the other two miss.
    mockGetCachedEtaV2
      .mockResolvedValueOnce(makeCacheValue(8)) // pair 1: hit
      .mockResolvedValueOnce(null) // pair 2: miss
      .mockResolvedValueOnce(null); // pair 3: miss

    mockDrivingRoute.mockResolvedValue({ distance: 6000, duration: 900 }); // 15 min

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // Pair 1 (deadhead driver→pickup): cached → 8
    expect(resolver(gp(30.28, 120.16), gp(30.2741, 120.1551))).toBe(8);
    // Pairs 2 & 3 (misses): Amap → 15
    expect(resolver(gp(30.32, 120.143), gp(30.2741, 120.1551))).toBe(15);
    expect(resolver(gp(30.2741, 120.1551), gp(30.32, 120.143))).toBe(15);

    // Amap called exactly twice (pairs 2 & 3).
    expect(mockDrivingRoute).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// 6. Amap failure
// ===========================================================================

describe("Amap failure", () => {
  it("failed Amap call → that pair returns null, successful pairs work", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);

    // 3 pairs for 1 driver + 1 order.
    //   (1) deadhead: driver→pickup     → success (10 min)
    //   (2) deadhead: delivery→pickup   → fail (AMAP_NO_ROUTE_FOUND)
    //   (3) service:  pickup→delivery   → fail (AMAP_TIMEOUT)
    mockDrivingRoute
      .mockResolvedValueOnce({ distance: 5000, duration: 600 }) // pair 1
      .mockRejectedValueOnce(new Error("AMAP_NO_ROUTE_FOUND")) // pair 2
      .mockRejectedValueOnce(new Error("AMAP_TIMEOUT")); // pair 3

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // Pair 1: successful → 10
    expect(resolver(gp(30.28, 120.16), gp(30.2741, 120.1551))).toBe(10);
    // Pair 2: failed → null
    expect(resolver(gp(30.32, 120.143), gp(30.2741, 120.1551))).toBeNull();
    // Pair 3: failed → null
    expect(resolver(gp(30.2741, 120.1551), gp(30.32, 120.143))).toBeNull();
  });

  it("all Amap calls fail → resolver returns null for all, no cache writes", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);
    mockDrivingRoute.mockRejectedValue(new Error("AMAP_TIMEOUT"));

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    expect(resolver(gp(30.28, 120.16), gp(30.2741, 120.1551))).toBeNull();
    expect(resolver(gp(30.2741, 120.1551), gp(30.32, 120.143))).toBeNull();
    expect(mockCacheEtaV2).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. Cache writes on success
// ===========================================================================

describe("cache writes on success", () => {
  it("successful Amap result is written to Redis with correct params", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);
    mockDrivingRoute.mockResolvedValue({ distance: 7777, duration: 1234 });

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    await buildEtaMatrix(input);

    expect(mockCacheEtaV2).toHaveBeenCalled();
    // Verify the cache value carries real ETA data.
    const cacheCall = mockCacheEtaV2.mock.calls[0];
    expect(cacheCall[2]).toBe("driving"); // mode
    expect(cacheCall[3].etaMinutes).toBe(21); // Math.ceil(1234/60) = 21
    expect(cacheCall[3].distanceMeters).toBe(7777);
    expect(cacheCall[3].durationSeconds).toBe(1234);
  });
});

// ===========================================================================
// 8. Amap failure → no cache write
// ===========================================================================

describe("Amap failure → no cache write", () => {
  it("failed pairs are NOT written to Redis", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);
    mockDrivingRoute.mockRejectedValue(new Error("AMAP_NO_ROUTE_FOUND"));

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    await buildEtaMatrix(input);

    // No cache writes at all.
    expect(mockCacheEtaV2).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. Deduplication
// ===========================================================================

describe("deduplication", () => {
  it("same coordinate pair is queried only once", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);

    // Two orders with identical pickup AND delivery locations.
    // Both produce the exact same deadhead + service pairs.
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [
        makeOrder({
          orderId: "o1",
          pickupLocation: gp(30.27, 120.15),
          deliveryLocation: gp(30.32, 120.14)
        }),
        makeOrder({
          orderId: "o2",
          pickupLocation: gp(30.27, 120.15),
          deliveryLocation: gp(30.32, 120.14)
        })
      ],
      drivers: [makeDriver()]
    };

    await buildEtaMatrix(input);

    // The unique pairs should be:
    // - deadhead: 1 origin (driver) × 1 unique pickup = 1
    // - deadhead: 1 unique delivery origin × 1 unique pickup = 1
    // - service: 1 unique pickup × 1 unique delivery = 1
    // = 3 unique pairs
    // NOT 2 orders × (2 pairs each) = 4+ with duplicates
    expect(mockGetCachedEtaV2).toHaveBeenCalledTimes(3);
  });

  it("orders with coordinates that differ by <0.1m are deduplicated via hash", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);

    // Two pickups that differ by 0.000001 degrees (~0.1 m) → same 6-decimal hash.
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [
        makeOrder({
          orderId: "o1",
          pickupLocation: gp(30.2741000001, 120.1551000001)
        }),
        makeOrder({
          orderId: "o2",
          pickupLocation: gp(30.2741000002, 120.1551000002)
        })
      ],
      drivers: [makeDriver()]
    };

    await buildEtaMatrix(input);

    // The two pickups hash to the same key → only one deadhead pair from driver.
    // Service pairs: 1 pickup × 1 delivery location (o1 and o2 have different delivery
    // but we're testing pickup dedup here). Actually both orders have the same
    // delivery location (from makeOrder default) so service pairs also dedup.
    // Total: deadhead 1 + deadhead(delivery→pickup) 1 + service 1 = ~3 unique
    const callCount = mockGetCachedEtaV2.mock.calls.length;
    // Should be fewer than 6 (2 orders × 3 pairs without dedup).
    expect(callCount).toBeLessThan(6);
  });
});

// ===========================================================================
// 10. Redis write failure → resolver still works
// ===========================================================================

describe("Redis write resilience", () => {
  it("cacheEtaV2 rejection does not prevent resolver from working", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);
    mockDrivingRoute.mockResolvedValue({ distance: 5000, duration: 600 }); // 10 min
    mockCacheEtaV2.mockRejectedValue(new Error("Redis connection lost"));

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    // Must NOT throw.
    const resolver = await buildEtaMatrix(input);

    // Resolver still works from in-memory lookup.
    expect(resolver(gp(30.28, 120.16), gp(30.2741, 120.1551))).toBe(10);
  });
});

// ===========================================================================
// 11. Unknown pair → null
// ===========================================================================

describe("unknown pair → null", () => {
  it("resolver returns null for a pair not in the pre-computed matrix", async () => {
    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [makeOrder()],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // A pair that was never pre-computed (completely different coordinates).
    const result = resolver(gp(40.0, 116.0), gp(39.0, 117.0));
    expect(result).toBeNull();
  });
});

// ===========================================================================
// 12. Cross-order deadhead
// ===========================================================================

describe("cross-order deadhead coverage", () => {
  it("order A deliveryLocation→order B pickupLocation is pre-computed", async () => {
    mockGetCachedEtaV2.mockResolvedValue(null);
    mockDrivingRoute.mockResolvedValue({ distance: 3000, duration: 480 }); // 8 min

    const input: DispatchInputV2 = {
      event: BASE_EVENT,
      orders: [
        makeOrder({
          orderId: "o1",
          pickupLocation: gp(30.2741, 120.1551),
          deliveryLocation: gp(30.32, 120.143)
        }),
        makeOrder({
          orderId: "o2",
          pickupLocation: gp(30.33, 120.15),
          deliveryLocation: gp(30.35, 120.16)
        })
      ],
      drivers: [makeDriver()]
    };

    const resolver = await buildEtaMatrix(input);

    // 1 driver + 2 orders with all-different coords:
    //   Deadhead: 3 origins × 2 pickups = 6
    //   Service:  2 (per-order, one each)
    //   Total: 8 pairs (NOT 10 — service is NOT Cartesian product)
    expect(mockGetCachedEtaV2).toHaveBeenCalledTimes(8);

    // After completing o1 at its delivery, deadhead to o2's pickup.
    const eta = resolver(gp(30.32, 120.143), gp(30.33, 120.15));
    expect(eta).toBe(8);

    // Driver→pickup is also covered.
    expect(resolver(gp(30.28, 120.16), gp(30.2741, 120.1551))).toBe(8);

    // Service leg: each order's own pickup→delivery.
    expect(resolver(gp(30.2741, 120.1551), gp(30.32, 120.143))).toBe(8); // o1 service
    expect(resolver(gp(30.33, 120.15), gp(30.35, 120.16))).toBe(8); // o2 service
  });

  it("covers every plan-pool delivery cursor even when the matrix exceeds eight origins", async () => {
    const orders = Array.from({ length: 12 }, (_, index) =>
      makeOrder({
        orderId: `o-${index}`,
        pickupLocation: gp(30 + index * 0.01, 120 + index * 0.01),
        deliveryLocation: gp(31 + index * 0.01, 121 + index * 0.01)
      })
    );
    const drivers = Array.from({ length: 12 }, (_, index) =>
      makeDriver({
        driverId: `d-${index}`,
        lastLocation: {
          lat: 29 + index * 0.01,
          lng: 119 + index * 0.01,
          accuracyMeters: 10,
          capturedAt: new Date(NOW).toISOString()
        }
      })
    );

    await buildEtaMatrix({ event: BASE_EVENT, orders, drivers });

    // 12 pickups × (12 driver origins + 12 possible delivery cursors)
    // + 12 per-order service legs.
    expect(mockGetCachedEtaV2).toHaveBeenCalledTimes(
      (drivers.length + orders.length) * orders.length + orders.length
    );
  });

  it("keeps the driver origin and existing timeline cursor when more than eight deliveries are nearer", async () => {
    const targetPickup = gp(30, 120);
    const driverOrigin = gp(35, 125);
    const timelineCursor = gp(34, 124);
    const timelineOrder = makeOrder({
      orderId: "timeline-order",
      executionStatus: "PLANNED",
      currentAssignmentId: "asg-1",
      pickupLocation: gp(33.9, 123.9),
      deliveryLocation: timelineCursor
    });
    const targetOrder = makeOrder({
      orderId: "target-order",
      pickupLocation: targetPickup,
      deliveryLocation: gp(32, 122)
    });
    const nearbyDeliveryOrders = Array.from({ length: 9 }, (_, index) =>
      makeOrder({
        orderId: `nearby-${index}`,
        pickupLocation: gp(31 + index * 0.001, 121 + index * 0.001),
        deliveryLocation: gp(
          30 + (index + 1) * 0.0001,
          120 + (index + 1) * 0.0001
        )
      })
    );

    const resolver = await buildEtaMatrix({
      event: BASE_EVENT,
      orders: [timelineOrder, targetOrder, ...nearbyDeliveryOrders],
      drivers: [
        makeDriver({
          lastLocation: {
            ...driverOrigin,
            accuracyMeters: 10,
            capturedAt: new Date(NOW).toISOString()
          },
          assignments: [
            {
              assignmentId: "asg-1",
              orderId: "timeline-order",
              sequenceNo: 1,
              lockType: "AUTO_FROZEN",
              executionStatus: "EN_ROUTE",
              deliveryLocation: timelineCursor,
              serviceModuleMinutes: 0
            }
          ]
        })
      ]
    });

    expect(resolver(driverOrigin, targetPickup)).toBe(15);
    expect(resolver(timelineCursor, targetPickup)).toBe(15);
  });

  it("keeps a newly planned A delivery cursor so the next order can enter B", async () => {
    mockDrivingRoute.mockResolvedValue({ distance: 3000, duration: 300 });

    const event = {
      type: "ORDER_RECEIVED" as const,
      occurredAt: "2026-07-19T08:00:00.000Z",
      orderId: "order-a"
    };
    const orderA = makeOrder({
      orderId: "order-a",
      orderNo: "ORDER-A",
      promisedPickupAt: "2026-07-19T09:00:00.000Z",
      pickupLocation: gp(30.1, 120.1),
      deliveryLocation: gp(30.2, 120.2)
    });
    const orderB = makeOrder({
      orderId: "order-b",
      orderNo: "ORDER-B",
      promisedPickupAt: "2026-07-19T10:00:00.000Z",
      pickupLocation: gp(30.3, 120.3),
      deliveryLocation: gp(30.4, 120.4)
    });
    const availableDriver = makeDriver({
      driverId: "available-driver",
      lastLocation: {
        lat: 30,
        lng: 120,
        accuracyMeters: 10,
        capturedAt: event.occurredAt
      }
    });
    const unavailableDrivers = Array.from({ length: 7 }, (_, index) =>
      makeDriver({
        driverId: `unavailable-driver-${index}`,
        availability: "UNAVAILABLE",
        lastLocation: {
          lat: 31 + index * 0.01,
          lng: 121 + index * 0.01,
          accuracyMeters: 10,
          capturedAt: event.occurredAt
        }
      })
    );
    const input: DispatchInputV2 = {
      event,
      orders: [orderA, orderB],
      drivers: [availableDriver, ...unavailableDrivers]
    };

    const resolver = await buildEtaMatrix(input);
    const result = runDispatchV2(input, resolver);

    expect(result.evaluations).toEqual([
      {
        orderId: "order-a",
        result: "PLANNED",
        bestSlackMinutes: 55,
        reason: "PLANNED"
      },
      {
        orderId: "order-b",
        result: "PLANNED",
        bestSlackMinutes: 105,
        reason: "PLANNED"
      }
    ]);
    expect(result.proposals[0]?.assignments).toMatchObject([
      {
        orderId: "order-a",
        slot: "A",
        etaAvailable: true
      },
      {
        orderId: "order-b",
        slot: "B",
        deadheadEtaMinutes: 5,
        etaAvailable: true
      }
    ]);
  });
});

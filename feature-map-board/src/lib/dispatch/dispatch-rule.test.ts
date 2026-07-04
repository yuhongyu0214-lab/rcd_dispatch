import { describe, expect, it, vi } from "vitest";

import { applyDispatchConstraints } from "./constraints";
import { getEtaResults } from "./eta";
import { filterDispatchCandidates } from "./filter";
import { rankDispatchCandidates } from "./sort";
import type { DispatchCandidate } from "./types";

const baseCandidate: DispatchCandidate = {
  activeOrders: { door: 0, store: 0 },
  driverId: "driver-s1",
  driverName: "李强",
  driverStatus: "S1",
  origin: { lat: 31.1977, lng: 121.3275 },
  storeId: "store-sh",
  storeName: "上海虹桥店"
};

describe("dispatch-rule-v1", () => {
  it("filters out unavailable drivers and door-order occupied drivers", () => {
    const candidates = filterDispatchCandidates({
      orderType: "DOOR_DELIVERY",
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
          status: "S1",
          storeId: "store-sh",
          store: { id: "store-sh", name: "上海虹桥店" }
        },
        {
          assignments: [],
          id: "driver-unavailable",
          name: "赵伟",
          status: "UNAVAILABLE",
          storeId: "store-sh",
          store: { id: "store-sh", name: "上海虹桥店" }
        },
        {
          assignments: [{ order: { type: "DOOR_PICKUP" } }],
          id: "driver-door-busy",
          name: "周敏",
          status: "S4",
          storeId: "store-sh",
          store: { id: "store-sh", name: "上海虹桥店" }
        }
      ]
    });

    expect(candidates.map((candidate) => candidate.driverId)).toEqual(["driver-s1"]);
  });

  it("ranks store-order candidates by status, ETA, and load penalty", () => {
    const topN = rankDispatchCandidates({
      candidates: [
        {
          ...baseCandidate,
          activeOrders: { door: 0, store: 2 },
          driverId: "driver-s1-busy",
          driverStatus: "S1"
        },
        {
          ...baseCandidate,
          activeOrders: { door: 0, store: 0 },
          driverId: "driver-s1-idle",
          driverName: "周敏",
          driverStatus: "S1"
        },
        {
          ...baseCandidate,
          driverId: "driver-s2",
          driverName: "王磊",
          driverStatus: "S2"
        }
      ],
      etaResults: [
        { driverId: "driver-s1-busy", etaMinutes: 12 },
        { driverId: "driver-s1-idle", etaMinutes: 16 },
        { driverId: "driver-s2", etaMinutes: 8 }
      ],
      orderType: "STORE_PICKUP",
      topNLimit: 3
    });

    expect(topN[0].driverId).toBe("driver-s1-idle");
    expect(topN[1].loadPenaltyMinutes).toBe(14);
    expect(topN[0].reason).toContain("预计到达 16 分钟");
  });

  it("returns manual outcome when the best ETA reaches threshold", () => {
    const result = applyDispatchConstraints({
      orderId: "order-1",
      orderNo: "D3832",
      orderType: "STORE_PICKUP",
      topN: [
        {
          ...baseCandidate,
          activeDoorOrders: 0,
          activeStoreOrders: 0,
          etaMinutes: 120,
          loadPenaltyMinutes: 0,
          priorityRank: 1,
          reason: "门店空闲，预计到达 120 分钟",
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

  it("degrades failed AMap ETA to 9999 without throwing", async () => {
    const originalKey = process.env.AMAP_SERVER_KEY;
    process.env.AMAP_SERVER_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      })
    );

    const result = await getEtaResults({
      candidates: [baseCandidate],
      destination: { lat: 31.1942, lng: 121.3268 },
      traceId: "trace-test"
    });

    expect(result).toEqual([{ driverId: "driver-s1", etaMinutes: 9999 }]);

    process.env.AMAP_SERVER_KEY = originalKey;
    vi.unstubAllGlobals();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { driverFindUnique } = vi.hoisted(() => ({
  driverFindUnique: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: {
      findUnique: driverFindUnique
    }
  }
}));

import { filterDispatchCandidates } from "@/lib/dispatch/filter";
import { getDriverLocationFreshness } from "@/lib/location";
import { __setRedisClientForTests } from "@/lib/redis";

const TEST_REDIS_PREFIX = "rcd:v2:test:";

class ColdStartRedisClient {
  status = "wait";
  connectCalls = 0;
  existsCalls = 0;
  locations = new Map<string, Record<string, string>>();
  onlineKeys = new Set<string>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.status = "ready";
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.locations.get(key) ?? {};
  }

  async exists(key: string): Promise<number> {
    this.existsCalls += 1;
    return this.onlineKeys.has(key) ? 1 : 0;
  }
}

let redis: ColdStartRedisClient;

beforeEach(() => {
  driverFindUnique.mockReset();
  driverFindUnique.mockResolvedValue(null);
  process.env.REDIS_KEY_PREFIX = TEST_REDIS_PREFIX;
  redis = new ColdStartRedisClient();
  __setRedisClientForTests(redis as never);
});

afterEach(() => {
  __setRedisClientForTests(null);
  delete process.env.REDIS_KEY_PREFIX;
});

describe("Redis cold start callers", () => {
  it("connects before location freshness reads the first Redis sample", async () => {
    redis.locations.set(`${TEST_REDIS_PREFIX}driver:last_location:driver-1`, {
      lat: "31.2304",
      lng: "121.4737",
      ts: new Date(Date.now() - 10_000).toISOString(),
      server_ts: String(Date.now()),
      status: "ACTIVE"
    });

    await expect(
      getDriverLocationFreshness("driver-1")
    ).resolves.toBe("FRESH");
    expect(redis.connectCalls).toBe(1);
    expect(driverFindUnique).not.toHaveBeenCalled();
  });

  it("connects before V1 candidate filtering checks the first online key", async () => {
    redis.onlineKeys.add(`${TEST_REDIS_PREFIX}driver:online:driver-1`);

    const result = await filterDispatchCandidates({
      orderType: "DOOR_DELIVERY",
      orderStoreId: "store-1",
      orderLat: 31.2304,
      orderLng: 121.4737,
      originsByDriverId: new Map([
        ["driver-1", { lat: 31.2304, lng: 121.4737 }]
      ]),
      drivers: [
        {
          assignments: [],
          id: "driver-1",
          name: "测试司机",
          phone: "13800000000",
          status: "S1",
          storeId: "store-1",
          lastLat: 31.2304,
          lastLng: 121.4737,
          store: { id: "store-1", name: "测试门店" }
        }
      ]
    });

    expect(result.candidates.map((candidate) => candidate.driverId)).toEqual([
      "driver-1"
    ]);
    expect(redis.connectCalls).toBe(1);
    expect(redis.existsCalls).toBe(1);
  });
});

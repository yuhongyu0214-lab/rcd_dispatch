import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  __setRedisClientForTests,
  acquireResourceLock,
  acquireResourceLocks,
  cacheEtaV2,
  getCachedEtaV2,
  getDriverLocations,
  getDriverLocationsWithStatus,
  normalizePointHash,
  releaseResourceLock,
  SET_LOCATION_IF_NEWER_SCRIPT,
  setDriverLocation,
  setDriverLocationIfNewer,
  setDriverOnline,
} from "./redis";

import type { DriverLocation, PipelineLike, RedisClientLike } from "./redis";

// ============================================================================
// FakeRedisClient — full-featured fake for 1B location primitives
// ============================================================================

class FakeRedisClient implements RedisClientLike {
  hashes = new Map<string, Record<string, string>>();
  strings = new Map<string, { value: string; ex?: number }>();
  expires = new Map<string, number>();
  evalFails = false;
  pipelineFails = false;
  status = "ready";

  async hset(key: string, ...args: string[]): Promise<number> {
    const hash = this.hashes.get(key) ?? {};
    for (let i = 0; i < args.length; i += 2) {
      hash[args[i]] = args[i + 1];
    }
    this.hashes.set(key, hash);
    return args.length / 2;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expires.set(key, Number(seconds));
    return 1;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<"OK" | null> {
    const exIndex = args.findIndex((a) => a === "EX");
    const ex = exIndex >= 0 ? Number(args[exIndex + 1]) : undefined;
    this.strings.set(key, { value, ex });
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key)?.value ?? null;
  }

  async exists(key: string): Promise<number> {
    return this.strings.has(key) || this.hashes.has(key) ? 1 : 0;
  }

  async del(key: string): Promise<number> {
    const had = this.strings.delete(key) || this.hashes.delete(key);
    return had ? 1 : 0;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async scan(): Promise<[string, string[]]> {
    return ["0", []];
  }

  async eval(
    script: string,
    numkeys: number,
    ...args: unknown[]
  ): Promise<unknown> {
    if (this.evalFails) throw new Error("eval failed (injected)");

    expect(script).toBe(SET_LOCATION_IF_NEWER_SCRIPT);
    expect(numkeys).toBe(1);

    const key = String(args[0]);
    const argv = args.slice(1).map(String);
    const incoming = Number(argv[0]);
    const ttl = Number(argv[1]);
    const fieldPairs = argv.slice(2);

    const existingRaw = this.hashes.get(key)?.ts_ms;
    const existing = existingRaw !== undefined ? Number(existingRaw) : null;
    if (existing !== null && Number.isFinite(existing)) {
      if (incoming < existing) return -1;
      if (incoming === existing) return 0;
    }

    await this.hset(key, ...fieldPairs);
    this.expires.set(key, ttl);
    return 1;
  }

  pipeline(): PipelineLike {
    const keys: string[] = [];
    const self = this;
    return {
      hgetall(key: string): void {
        keys.push(key);
      },
      exists(): void {
        // not used in these tests
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        if (self.pipelineFails) throw new Error("pipeline failed (injected)");
        return keys.map((key) => [null, self.hashes.get(key) ?? {}]);
      },
    };
  }

  on(): void {
    // not used in these tests
  }

  async quit(): Promise<void> {
    // not used in these tests
  }
}

// ============================================================================
// Simple fake client for Gate 3 resource-lock / ETA-cache primitives
// ============================================================================

type FakeClientV3 = {
  store: Map<string, string>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn> | null;
};

function makeFakeV3(): FakeClientV3 {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn((key: string, value: string, ...args: string[]) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn((key: string) => store.get(key) ?? null),
    del: vi.fn((key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    eval: vi.fn(),
  };
}

// ============================================================================
// 1B helpers
// ============================================================================

function sample(overrides: Partial<DriverLocation> = {}): DriverLocation {
  return {
    lat: "30.5728",
    lng: "104.0668",
    accuracy: "10",
    ts: "2026-07-19T08:00:00.000Z",
    server_ts: "1784448000000",
    status: "ACTIVE",
    ...overrides,
  };
}

const KEY = "driver:last_location:d-1";
const T1 = 1_784_448_000_000;
const T2 = T1 + 30_000;
const T3 = T2 + 30_000;

let fake: FakeRedisClient;

beforeEach(() => {
  delete process.env.REDIS_URL;
  fake = new FakeRedisClient();
  __setRedisClientForTests(fake);
});

afterEach(() => {
  __setRedisClientForTests(null);
});

// ============================================================================
// 1B — setDriverLocationIfNewer: atomic monotonic write
// ============================================================================

describe("setDriverLocationIfNewer", () => {
  it("空缓存首写 applied，写入 ts_ms 且 TTL 精确为 180 秒", async () => {
    const outcome = await setDriverLocationIfNewer("d-1", sample(), T1);

    expect(outcome).toBe("applied");
    expect(fake.hashes.get(KEY)?.ts_ms).toBe(String(T1));
    expect(fake.hashes.get(KEY)?.lat).toBe("30.5728");
    expect(fake.expires.get(KEY)).toBe(180);
  });

  it("交错写入：先写新样本后写旧样本，旧位置不能覆盖新位置", async () => {
    await setDriverLocationIfNewer("d-1", sample({ lat: "31.0000" }), T2);
    const outcome = await setDriverLocationIfNewer(
      "d-1",
      sample({ lat: "30.0000" }),
      T1
    );

    expect(outcome).toBe("stale");
    expect(fake.hashes.get(KEY)?.lat).toBe("31.0000");
    expect(fake.hashes.get(KEY)?.ts_ms).toBe(String(T2));
  });

  it("同时间戳并发仅一次生效，第二次返回 duplicate 且不改写字段", async () => {
    await setDriverLocationIfNewer("d-1", sample({ server_ts: "first" }), T1);
    const outcome = await setDriverLocationIfNewer(
      "d-1",
      sample({ server_ts: "second" }),
      T1
    );

    expect(outcome).toBe("duplicate");
    expect(fake.hashes.get(KEY)?.server_ts).toBe("first");
  });

  it("严格更新样本 applied 并推进 ts_ms", async () => {
    await setDriverLocationIfNewer("d-1", sample(), T1);
    const outcome = await setDriverLocationIfNewer(
      "d-1",
      sample({ lat: "31.5000" }),
      T3
    );

    expect(outcome).toBe("applied");
    expect(fake.hashes.get(KEY)?.lat).toBe("31.5000");
    expect(fake.hashes.get(KEY)?.ts_ms).toBe(String(T3));
  });

  it("V1 遗留 hash（无 ts_ms）按可覆盖处理", async () => {
    await fake.hset(KEY, "lat", "29.0000", "ts", "2026-07-19T07:00:00.000Z");

    const outcome = await setDriverLocationIfNewer("d-1", sample(), T1);

    expect(outcome).toBe("applied");
    expect(fake.hashes.get(KEY)?.ts_ms).toBe(String(T1));
  });

  it("eval 异常返回 unavailable（调用方转 DB 重判）", async () => {
    fake.evalFails = true;

    const outcome = await setDriverLocationIfNewer("d-1", sample(), T1);

    expect(outcome).toBe("unavailable");
  });

  it("无客户端（降级）返回 unavailable，不做非原子退化写入", async () => {
    __setRedisClientForTests(null);

    const outcome = await setDriverLocationIfNewer("d-1", sample(), T1);

    expect(outcome).toBe("unavailable");
  });

  it("脚本文本包含原子比较与过期语义", () => {
    expect(SET_LOCATION_IF_NEWER_SCRIPT).toContain("HGET");
    expect(SET_LOCATION_IF_NEWER_SCRIPT).toContain("ts_ms");
    expect(SET_LOCATION_IF_NEWER_SCRIPT).toContain("EXPIRE");
    expect(SET_LOCATION_IF_NEWER_SCRIPT).toContain("unpack(ARGV, 3)");
  });
});

// ============================================================================
// 1B — real-time key TTL unified at 180s
// ============================================================================

describe("实时键 TTL", () => {
  it("legacy setDriverLocation 的 EXPIRE 为 180 秒", async () => {
    await setDriverLocation("d-1", sample());

    expect(fake.expires.get(KEY)).toBe(180);
  });

  it("setDriverOnline 的 EX 为 180 秒", async () => {
    await setDriverOnline("d-1");

    expect(fake.strings.get("driver:online:d-1")?.ex).toBe(180);
  });
});

// ============================================================================
// 1B — getDriverLocationsWithStatus: three-state batch read
// ============================================================================

describe("getDriverLocationsWithStatus", () => {
  it("Redis 正常：命中司机返回位置，无键司机返回 null（个体缺失）", async () => {
    await setDriverLocationIfNewer("d-1", sample(), T1);

    const { redisAvailable, locations } = await getDriverLocationsWithStatus([
      "d-1",
      "d-2",
    ]);

    expect(redisAvailable).toBe(true);
    expect(locations.get("d-1")?.lat).toBe("30.5728");
    expect(locations.get("d-1")?.ts_ms).toBe(String(T1));
    expect(locations.get("d-2")).toBeNull();
  });

  it("无客户端（降级）：redisAvailable=false 且全部 null（整体不可用）", async () => {
    __setRedisClientForTests(null);

    const { redisAvailable, locations } = await getDriverLocationsWithStatus([
      "d-1",
      "d-2",
    ]);

    expect(redisAvailable).toBe(false);
    expect(locations.get("d-1")).toBeNull();
    expect(locations.get("d-2")).toBeNull();
  });

  it("管道整体失败：redisAvailable=false 且全部 null", async () => {
    fake.pipelineFails = true;

    const { redisAvailable, locations } = await getDriverLocationsWithStatus([
      "d-1",
    ]);

    expect(redisAvailable).toBe(false);
    expect(locations.get("d-1")).toBeNull();
  });

  it("空入参直接返回空 Map", async () => {
    const { locations } = await getDriverLocationsWithStatus([]);

    expect(locations.size).toBe(0);
  });

  it("兼容入口 getDriverLocations 返回相同的位置数据", async () => {
    await setDriverLocationIfNewer("d-1", sample(), T1);

    const locations = await getDriverLocations(["d-1", "d-2"]);

    expect(locations.get("d-1")?.lat).toBe("30.5728");
    expect(locations.get("d-2")).toBeNull();
  });
});

// ============================================================================
// Gate 3 — acquireResourceLock
// ============================================================================

describe("acquireResourceLock", () => {
  let fakeV3: FakeClientV3;

  beforeEach(() => {
    fakeV3 = makeFakeV3();
    __setRedisClientForTests(fakeV3 as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it('returns "acquired" on first NX SET', async () => {
    expect(await acquireResourceLock("lock:o1", "tok-a")).toBe("acquired");
  });

  it('returns "busy" when held by another token', async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    expect(await acquireResourceLock("lock:o1", "tok-b")).toBe("busy");
  });

  it('returns "acquired" after lock is deleted', async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    fakeV3.store.delete("lock:o1");
    expect(await acquireResourceLock("lock:o1", "tok-b")).toBe("acquired");
  });
});

// ============================================================================
// Gate 3 — releaseResourceLock
// ============================================================================

describe("releaseResourceLock", () => {
  let fakeV3: FakeClientV3;

  beforeEach(() => {
    fakeV3 = makeFakeV3();
    fakeV3.eval = vi.fn(
      (_s: string, _n: number, key: string, token: string) => {
        if (fakeV3.store.get(key) === token) {
          fakeV3.store.delete(key);
          return 1;
        }
        return 0;
      }
    );
    __setRedisClientForTests(fakeV3 as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it("deletes key when token matches via Lua", async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-a");
    expect(fakeV3.store.has("lock:o1")).toBe(false);
  });

  it("does NOT delete key when token mismatches", async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-b");
    expect(fakeV3.store.has("lock:o1")).toBe(true);
  });

  it("defers to TTL when eval unavailable (no bare DEL)", async () => {
    fakeV3.eval = null;
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-a");
    expect(fakeV3.store.has("lock:o1")).toBe(true);
    const delKeys = (fakeV3.del as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: string[]) => c[0]
    );
    expect(delKeys).not.toContain("lock:o1");
  });
});

// ============================================================================
// Gate 3 — acquireResourceLocks
// ============================================================================

describe("acquireResourceLocks", () => {
  let fakeV3: FakeClientV3;

  beforeEach(() => {
    fakeV3 = makeFakeV3();
    __setRedisClientForTests(fakeV3 as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it("acquires all when free", async () => {
    const r = await acquireResourceLocks([
      { resourceKey: "lock:b", token: "t1" },
      { resourceKey: "lock:a", token: "t1" },
    ]);
    expect(r.get("lock:a")).toBe("acquired");
    expect(r.get("lock:b")).toBe("acquired");
  });

  it("releases acquired locks on partial failure", async () => {
    fakeV3.eval = vi.fn(
      (_s: string, _n: number, key: string, token: string) => {
        if (fakeV3.store.get(key) === token) {
          fakeV3.store.delete(key);
          return 1;
        }
        return 0;
      }
    );
    await acquireResourceLock("lock:b", "pre");
    const r = await acquireResourceLocks([
      { resourceKey: "lock:a", token: "t1" },
      { resourceKey: "lock:b", token: "t1" },
    ]);
    expect(r.get("lock:a")).toBe("acquired");
    expect(r.get("lock:b")).toBe("busy");
    expect(fakeV3.store.has("lock:a")).toBe(false); // released
  });
});

// ============================================================================
// Gate 3 — normalizePointHash
// ============================================================================

describe("normalizePointHash", () => {
  it("stable output for same coordinates", () => {
    expect(
      normalizePointHash({ lat: 30.2741, lng: 120.1551 })
    ).toBe(normalizePointHash({ lat: 30.2741, lng: 120.1551 }));
  });

  it("rounds to 6 decimal places", () => {
    expect(
      normalizePointHash({ lat: 30.2741001, lng: 120.1551009 })
    ).toBe("30.274100,120.155101");
  });

  it("different coords produce different hash", () => {
    expect(
      normalizePointHash({ lat: 30.2741, lng: 120.1551 })
    ).not.toBe(normalizePointHash({ lat: 30.2742, lng: 120.1551 }));
  });
});

// ============================================================================
// Gate 3 — cacheEtaV2 / getCachedEtaV2
// ============================================================================

describe("cacheEtaV2 / getCachedEtaV2", () => {
  let fakeV3: FakeClientV3;

  beforeEach(() => {
    fakeV3 = makeFakeV3();
    __setRedisClientForTests(fakeV3 as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it("round-trip: cache then read", async () => {
    const v = {
      etaMinutes: 15,
      distanceMeters: 3000,
      durationSeconds: 900,
      cachedAt: Date.now(),
    };
    await cacheEtaV2("h1", "h2", "driving", v);
    const r = await getCachedEtaV2("h1", "h2", "driving");
    expect(r).not.toBeNull();
    expect(r!.etaMinutes).toBe(15);
  });

  it("cache miss returns null (no fake ETA)", async () => {
    expect(await getCachedEtaV2("x", "y", "driving")).toBeNull();
  });

  it("different modes isolate cache entries", async () => {
    const v1 = {
      etaMinutes: 15,
      distanceMeters: 3000,
      durationSeconds: 900,
      cachedAt: Date.now(),
    };
    const v2 = {
      etaMinutes: 20,
      distanceMeters: 3000,
      durationSeconds: 1200,
      cachedAt: Date.now(),
    };
    await cacheEtaV2("a", "b", "driving", v1);
    await cacheEtaV2("a", "b", "walking", v2);
    expect((await getCachedEtaV2("a", "b", "driving"))!.etaMinutes).toBe(15);
    expect((await getCachedEtaV2("a", "b", "walking"))!.etaMinutes).toBe(20);
  });
});

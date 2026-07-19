import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  acquireResourceLock,
  acquireResourceLocks,
  releaseResourceLock,
  normalizePointHash,
  cacheEtaV2,
  getCachedEtaV2,
  __setRedisClientForTests,
} from "./redis";

// ---------------------------------------------------------------------------
// Fake Redis client
// ---------------------------------------------------------------------------

type FakeClient = {
  store: Map<string, string>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn> | null;
};

function makeFake(): FakeClient {
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

// =========================================================================
// acquireResourceLock
// =========================================================================

describe("acquireResourceLock", () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFake();
    __setRedisClientForTests(fake as never);
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
    fake.store.delete("lock:o1");
    expect(await acquireResourceLock("lock:o1", "tok-b")).toBe("acquired");
  });
});

// =========================================================================
// releaseResourceLock
// =========================================================================

describe("releaseResourceLock", () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFake();
    fake.eval = vi.fn((_s: string, _n: number, key: string, token: string) => {
      if (fake.store.get(key) === token) {
        fake.store.delete(key);
        return 1;
      }
      return 0;
    });
    __setRedisClientForTests(fake as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it("deletes key when token matches via Lua", async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-a");
    expect(fake.store.has("lock:o1")).toBe(false);
  });

  it("does NOT delete key when token mismatches", async () => {
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-b");
    expect(fake.store.has("lock:o1")).toBe(true);
  });

  it("defers to TTL when eval unavailable (no bare DEL)", async () => {
    fake.eval = null;
    await acquireResourceLock("lock:o1", "tok-a");
    await releaseResourceLock("lock:o1", "tok-a");
    expect(fake.store.has("lock:o1")).toBe(true);
    const delKeys = (fake.del as ReturnType<typeof vi.fn>).mock.calls.map((c: string[]) => c[0]);
    expect(delKeys).not.toContain("lock:o1");
  });
});

// =========================================================================
// acquireResourceLocks
// =========================================================================

describe("acquireResourceLocks", () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFake();
    __setRedisClientForTests(fake as never);
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
    // Set up eval for releaseResourceLock to work
    fake.eval = vi.fn((_s: string, _n: number, key: string, token: string) => {
      if (fake.store.get(key) === token) {
        fake.store.delete(key);
        return 1;
      }
      return 0;
    });
    await acquireResourceLock("lock:b", "pre");
    const r = await acquireResourceLocks([
      { resourceKey: "lock:a", token: "t1" },
      { resourceKey: "lock:b", token: "t1" },
    ]);
    expect(r.get("lock:a")).toBe("acquired");
    expect(r.get("lock:b")).toBe("busy");
    expect(fake.store.has("lock:a")).toBe(false); // released
  });
});

// =========================================================================
// normalizePointHash
// =========================================================================

describe("normalizePointHash", () => {
  it("stable output for same coordinates", () => {
    expect(normalizePointHash({ lat: 30.2741, lng: 120.1551 }))
      .toBe(normalizePointHash({ lat: 30.2741, lng: 120.1551 }));
  });

  it("rounds to 6 decimal places", () => {
    expect(normalizePointHash({ lat: 30.2741001, lng: 120.1551009 }))
      .toBe("30.274100,120.155101");
  });

  it("different coords produce different hash", () => {
    expect(normalizePointHash({ lat: 30.2741, lng: 120.1551 }))
      .not.toBe(normalizePointHash({ lat: 30.2742, lng: 120.1551 }));
  });
});

// =========================================================================
// cacheEtaV2 / getCachedEtaV2
// =========================================================================

describe("cacheEtaV2 / getCachedEtaV2", () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = makeFake();
    __setRedisClientForTests(fake as never);
  });

  afterEach(() => {
    __setRedisClientForTests(null);
  });

  it("round-trip: cache then read", async () => {
    const v = { etaMinutes: 15, distanceMeters: 3000, durationSeconds: 900, cachedAt: Date.now() };
    await cacheEtaV2("h1", "h2", "driving", v);
    const r = await getCachedEtaV2("h1", "h2", "driving");
    expect(r).not.toBeNull();
    expect(r!.etaMinutes).toBe(15);
  });

  it("cache miss returns null (no fake ETA)", async () => {
    expect(await getCachedEtaV2("x", "y", "driving")).toBeNull();
  });

  it("different modes isolate cache entries", async () => {
    const v1 = { etaMinutes: 15, distanceMeters: 3000, durationSeconds: 900, cachedAt: Date.now() };
    const v2 = { etaMinutes: 20, distanceMeters: 3000, durationSeconds: 1200, cachedAt: Date.now() };
    await cacheEtaV2("a", "b", "driving", v1);
    await cacheEtaV2("a", "b", "walking", v2);
    expect((await getCachedEtaV2("a", "b", "driving"))!.etaMinutes).toBe(15);
    expect((await getCachedEtaV2("a", "b", "walking"))!.etaMinutes).toBe(20);
  });
});

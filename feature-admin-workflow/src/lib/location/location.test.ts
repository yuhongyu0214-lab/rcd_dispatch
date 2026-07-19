import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocationSampleV2, LocationFreshnessV2 } from "@/types/v2";

// ============================================================================
// Mock setup
// ============================================================================

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    isRedisAvailable: vi.fn(() => true),
    setDriverLocationIfNewer: vi.fn(() => Promise.resolve("applied")),
    setDriverOnline: vi.fn(() => Promise.resolve(undefined)),
    getDriverLocation: vi.fn(() => Promise.resolve(null)),
    __setRedisClientForTests: vi.fn()
  }
}));

vi.mock("@/lib/redis", () => mockRedis);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    driverLocationSample: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn()
    }
  }
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { prisma } from "@/lib/prisma";

import { calculateFreshness } from "./freshness";
import {
  DbClaimFailedError,
  getDriverLocationFreshness,
  isCandidateDriver,
  processLocationBatch
} from "./index";
import { shouldSaveSample } from "./sampling";
import { validateLocationSample } from "./validate";

// ============================================================================
// Helpers
// ============================================================================

function makeSample(overrides: Partial<LocationSampleV2> = {}): LocationSampleV2 {
  return {
    lat: 30.5,
    lng: 104.0,
    accuracyMeters: 10,
    capturedAt: new Date(Date.now() - 10_000).toISOString(),
    ...overrides
  };
}

function mockDbSample(overrides = {}) {
  const base = {
    id: "sample-1",
    driverId: "d-1",
    lat: 30.5,
    lng: 104.0,
    accuracyMeters: 10,
    capturedAt: new Date(Date.now() - 60_000),
    receivedAt: new Date(),
    createdAt: new Date(),
    ...overrides
  };
  return base;
}

// ============================================================================
// calculateFreshness — pure-function tests
// ============================================================================

describe("calculateFreshness", () => {
  it("returns FRESH when capturedAt is within 120 seconds", () => {
    const result = calculateFreshness(
      new Date(Date.now() - 50_000).toISOString(),
      Date.now()
    );
    expect(result.freshness).toBe("FRESH");
  });

  it("returns STALE when capturedAt is older than 120 seconds", () => {
    const result = calculateFreshness(
      new Date(Date.now() - 200_000).toISOString(),
      Date.now()
    );
    expect(result.freshness).toBe("STALE");
  });

  it("returns FRESH when capturedAt is a near-future date (within 120s window)", () => {
    // A future timestamp within 120s of server time is treated as FRESH
    // (the age calculation uses absolute delta).
    const result = calculateFreshness(
      new Date(Date.now() + 50_000).toISOString(),
      Date.now()
    );
    expect(result.freshness).toBe("FRESH");
  });
});

// ============================================================================
// shouldSaveSample — pure-function tests
// ============================================================================

describe("shouldSaveSample", () => {
  it("saves on business event", () => {
    const result = shouldSaveSample(makeSample(), null, true);
    expect(result.shouldSample).toBe(true);
    expect(result.reason).toBe("business_event");
  });

  it("saves on first sample", () => {
    const result = shouldSaveSample(makeSample(), null, false);
    expect(result.shouldSample).toBe(true);
    expect(result.reason).toBe("first_sample");
  });

  it("saves on time elapsed (>= 120s)", () => {
    const last = mockDbSample({ capturedAt: new Date(Date.now() - 200_000) });
    const result = shouldSaveSample(makeSample(), last as unknown as Parameters<typeof shouldSaveSample>[1], false);
    expect(result.shouldSample).toBe(true);
    expect(result.reason).toBe("time_elapsed");
  });
});

// ============================================================================
// validateLocationSample — pure-function tests
// ============================================================================

describe("validateLocationSample", () => {
  it("accepts valid sample", () => {
    const result = validateLocationSample(makeSample(), Date.now());
    expect(result.valid).toBe(true);
  });

  it("rejects accuracy > 100 meters", () => {
    const result = validateLocationSample(makeSample({ accuracyMeters: 200 }), Date.now());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("ACCURACY_TOO_LOW");
  });

  it("rejects clock skew", () => {
    const result = validateLocationSample(
      makeSample({ capturedAt: new Date(Date.now() + 120_000).toISOString() }),
      Date.now()
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("CLOCK_SKEW");
  });

  it("rejects expired at receipt", () => {
    const result = validateLocationSample(
      makeSample({ capturedAt: new Date(Date.now() - 200_000).toISOString() }),
      Date.now()
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("EXPIRED_AT_RECEIPT");
  });
});

// ============================================================================
// getDriverLocationFreshness — orchestration tests
// ============================================================================

describe("getDriverLocationFreshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.isRedisAvailable.mockReturnValue(false);
    mockRedis.getDriverLocation.mockResolvedValue(null);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);
  });

  it("falls back to DB when Redis is unavailable", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: new Date(Date.now() - 50_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");

    expect(result).toBe("FRESH");
    expect(mockRedis.getDriverLocation).not.toHaveBeenCalled();
  });

  it("returns NONE when no data anywhere", async () => {
    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe("NONE");
  });

  it("returns STALE when DB fallback position is older than 120s", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: new Date(Date.now() - 200_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe("STALE");
  });

  it("uses Redis when available and data present", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockResolvedValue({
      ts: new Date(Date.now() - 50_000).toISOString(),
      // prevent toISOString() crash by ensuring ts is a format-correct string
      lat: "30.5", lng: "104.0"
    });

    const result = await getDriverLocationFreshness("d-1");

    expect(result).toBe("FRESH");
    expect(mockRedis.getDriverLocation).toHaveBeenCalledWith("d-1");
  });

  it("falls through to DB when Redis has no data", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockResolvedValue(null);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: new Date(Date.now() - 70_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe("FRESH");
  });

  it("falls through to DB when Redis read throws", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockRejectedValue(new Error("Redis down"));
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: new Date(Date.now() - 70_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe("FRESH");
  });
});

// ============================================================================
// isCandidateDriver — orchestration tests
// ============================================================================

describe("isCandidateDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.isRedisAvailable.mockReturnValue(false);
    mockRedis.getDriverLocation.mockResolvedValue(null);
  });

  it("returns false when driver not on shift", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: false,
      availability: "AVAILABLE"
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns false when driver is UNAVAILABLE", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "UNAVAILABLE"
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns true when all three conditions are met", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "AVAILABLE"
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);
    mockRedis.getDriverLocation.mockResolvedValue({
      ts: new Date(Date.now() - 50_000).toISOString(),
      lat: "30.5", lng: "104.0"
    });

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(true);
  });
});

// ============================================================================
// processLocationBatch — DB high-water claim + Redis CAS + sampling
// ============================================================================

describe("processLocationBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.setDriverLocationIfNewer.mockResolvedValue("applied");
    mockRedis.setDriverOnline.mockResolvedValue(undefined);
    mockRedis.getDriverLocation.mockResolvedValue(null);

    vi.mocked(prisma.driverLocationSample.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.driverLocationSample.findMany).mockResolvedValue([]);
    vi.mocked(prisma.driverLocationSample.create).mockResolvedValue({
      id: "new-sample",
      driverId: "d-1",
      lat: 30.5,
      lng: 104.0,
      accuracyMeters: 10,
      capturedAt: new Date(),
      receivedAt: new Date(),
      createdAt: new Date()
    });
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null); // default: no re-read needed
    vi.mocked(prisma.driver.updateMany).mockResolvedValue({ count: 1 }); // claim succeeds
  });

  it("processes all valid samples successfully", async () => {
    const samples = [
      makeSample({ capturedAt: new Date(Date.now() - 10_000).toISOString() }),
      makeSample({ capturedAt: new Date(Date.now() - 20_000).toISOString() }),
      makeSample({ capturedAt: new Date(Date.now() - 30_000).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({ index: 0, status: "success" });
  });

  it("rejects samples with LOW accuracy", async () => {
    const samples = [
      makeSample({ accuracyMeters: 200, capturedAt: new Date(Date.now()).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      status: "skipped",
      reason: "ACCURACY_TOO_LOW"
    });
  });

  it("rejects samples with CLOCK_SKEW", async () => {
    const samples = [
      makeSample({ accuracyMeters: 10, capturedAt: new Date(Date.now() + 60_000).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");
    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toBe("CLOCK_SKEW");
  });

  it("rejects expired samples", async () => {
    const samples = [
      makeSample({ capturedAt: new Date(Date.now() - 200_000).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");
    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toBe("EXPIRED_AT_RECEIPT");
  });

  it("marks duplicate samples as DUPLICATE (in-batch)", async () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    const samples = [makeSample({ capturedAt: ts }), makeSample({ capturedAt: ts })];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0].status).toBe("success");
    expect(result.results[1]).toEqual({ index: 1, status: "skipped", reason: "DUPLICATE" });
  });

  it("handles mixed valid/invalid samples in a single batch", async () => {
    const samples = [
      makeSample({ accuracyMeters: 200, capturedAt: new Date(Date.now() - 5_000).toISOString() }),
      makeSample({ capturedAt: new Date(Date.now() - 10_000).toISOString() }),
      makeSample({ capturedAt: new Date(Date.now() + 60_000).toISOString() }),
      makeSample({ capturedAt: new Date(Date.now() - 30_000).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.results[0].reason).toBe("ACCURACY_TOO_LOW");
    expect(result.results[1].status).toBe("success");
    expect(result.results[2].reason).toBe("CLOCK_SKEW");
    expect(result.results[3].status).toBe("success");
  });

  it("handles duplicate within same batch", async () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    const samples = [
      makeSample({ capturedAt: ts, lat: 30.1 }),
      makeSample({ capturedAt: new Date(Date.now() - 15_000).toISOString(), lat: 30.2 }),
      makeSample({ capturedAt: ts, lat: 30.3 })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");
    expect(result.success).toBe(2);
    expect(result.results[2].status).toBe("skipped");
  });

  // ---- P0-1/P0-2: DB high-water claim idempotency ----

  it("skips sample when DB claim returns count=0 and re-read shows exact duplicate", async () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    vi.mocked(prisma.driver.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.driver.findUnique).mockResolvedValueOnce({
      lastLocationCapturedAt: new Date(ts)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const samples = [makeSample({ capturedAt: ts })];
    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({ index: 0, status: "skipped", reason: "DUPLICATE" });
  });

  it("conservatively skips out-of-order sample (DB mark > sample)", async () => {
    vi.mocked(prisma.driver.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.driver.findUnique).mockResolvedValueOnce({
      lastLocationCapturedAt: new Date(Date.now() - 5_000) // DB mark is newer
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const samples = [makeSample({ capturedAt: new Date(Date.now() - 30_000).toISOString() })];
    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    // reason is DUPLICATE (reusing the closed enum — OUT_OF_ORDER logged via dedup field)
    expect(result.results[0].reason).toBe("DUPLICATE");
  });

  it("throws DbClaimFailedError on DB claim infrastructure failure", async () => {
    vi.mocked(prisma.driver.updateMany).mockRejectedValueOnce(
      new Error("connection lost")
    );

    const samples = [makeSample()];
    await expect(
      processLocationBatch("d-1", samples, "trace-1")
    ).rejects.toThrow(DbClaimFailedError);
  });

  // ---- Redis CAS layer ----

  it("calls setDriverLocationIfNewer with claimed sample and tsMs", async () => {
    const now = new Date(Date.now() - 8_000);
    const samples = [makeSample({ capturedAt: now.toISOString() })];

    await processLocationBatch("d-1", samples, "trace-1");

    expect(mockRedis.setDriverLocationIfNewer).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockRedis.setDriverLocationIfNewer).mock.calls[0];
    expect(call[0]).toBe("d-1");
    expect(call[1].ts).toBe(now.toISOString());
    expect(call[2]).toBe(now.getTime()); // tsMs
  });

  it("does not call setDriverLocationIfNewer when claim fails (skipped)", async () => {
    vi.mocked(prisma.driver.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.driver.findUnique).mockResolvedValueOnce({
      lastLocationCapturedAt: new Date(Date.now() - 8_000) // already newer
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    await processLocationBatch("d-1", [makeSample()], "trace-1");

    expect(mockRedis.setDriverLocationIfNewer).not.toHaveBeenCalled();
  });

  it("calls setDriverOnline on a successful CAS write", async () => {
    await processLocationBatch("d-1", [makeSample()], "trace-1");

    expect(mockRedis.setDriverOnline).toHaveBeenCalledWith("d-1");
  });

  // ---- P2002 handling ----

  it("treats P2002 as DUPLICATE, not a write failure", async () => {
    const e = new Error("Unique constraint violation") as Error & { code: string };
    e.code = "P2002";
    vi.mocked(prisma.driverLocationSample.create).mockRejectedValueOnce(e);

    const samples = [makeSample()];
    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({ index: 0, status: "skipped", reason: "DUPLICATE" });
    // success should be 0 because the sample was skipped, not counted as success
    expect(result.success).toBe(0);
  });

  it("counts non-P2002 persistence errors as best-effort success", async () => {
    vi.mocked(prisma.driverLocationSample.create).mockRejectedValueOnce(
      new Error("random I/O error")
    );

    const samples = [makeSample()];
    const result = await processLocationBatch("d-1", samples, "trace-1");

    // Non-P2002 error: sample still counts as success (best-effort)
    expect(result.success).toBe(1);
  });

  // ---- Existing DB sample dedup (pre-batch bulk check) ----

  it("marks sample as DUPLICATE when capturedAt already exists in DB samples", async () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    vi.mocked(prisma.driverLocationSample.findMany).mockResolvedValue([
      { capturedAt: new Date(ts) } as unknown as Awaited<
        ReturnType<typeof prisma.driverLocationSample.findMany>
      >[number]
    ]);

    const samples = [makeSample({ capturedAt: ts })];
    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toBe("DUPLICATE");
  });
});

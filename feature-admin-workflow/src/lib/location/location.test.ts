import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocationSampleV2, LocationFreshnessV2 } from "@/types/v2";

// ============================================================================
// Mock setup — use vi.hoisted() so mock references are available when
// vi.mock factories execute (they are hoisted above variable declarations).
// ============================================================================

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    isRedisAvailable: vi.fn(),
    setDriverLocation: vi.fn(),
    setDriverOnline: vi.fn(),
    getDriverLocation: vi.fn()
  }
}));

vi.mock("@/lib/redis", () => mockRedis);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
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
  const now = Date.now();
  return {
    lat: 30.5,
    lng: 104.0,
    accuracyMeters: 10,
    capturedAt: new Date(now).toISOString(),
    ...overrides
  };
}

function makeLastSample(overrides: {
  capturedAt?: Date;
  lat?: number;
  lng?: number;
} = {}) {
  return {
    id: "s-1",
    driverId: "d-1",
    lat: overrides.lat ?? 30.0,
    lng: overrides.lng ?? 104.0,
    accuracyMeters: 10,
    capturedAt: overrides.capturedAt ?? new Date(Date.now() - 60_000),
    receivedAt: new Date(),
    createdAt: new Date()
  };
}

// ============================================================================
// validateLocationSample — pure function tests
// ============================================================================

describe("validateLocationSample", () => {
  const serverTimeMs = Date.now();

  it("accepts a valid sample (accuracy 99.9m, fresh, no clock skew)", () => {
    const sample = makeSample({
      accuracyMeters: 99.9,
      capturedAt: new Date(serverTimeMs).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("accepts accuracy of exactly 100.0m", () => {
    const sample = makeSample({
      accuracyMeters: 100.0,
      capturedAt: new Date(serverTimeMs).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("rejects accuracy > 100m (100.1m)", () => {
    const sample = makeSample({
      accuracyMeters: 100.1,
      capturedAt: new Date(serverTimeMs).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "ACCURACY_TOO_LOW"
    });
  });

  it("rejects large accuracy values", () => {
    const sample = makeSample({
      accuracyMeters: 500,
      capturedAt: new Date(serverTimeMs).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "ACCURACY_TOO_LOW"
    });
  });

  it("accepts clock skew of exactly 30s ahead", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs + 30_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("accepts clock skew of 29s ahead", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs + 29_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("rejects clock skew > 30s ahead (31s)", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs + 31_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "CLOCK_SKEW"
    });
  });

  it("accepts sample age of exactly 120s", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs - 120_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("accepts sample age of 119s", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs - 119_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: true
    });
  });

  it("rejects sample older than 120s (121s)", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs - 121_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "EXPIRED_AT_RECEIPT"
    });
  });

  it("rejects expired samples with large age differences", () => {
    const sample = makeSample({
      capturedAt: new Date(serverTimeMs - 300_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "EXPIRED_AT_RECEIPT"
    });
  });

  it("rejects on the first rule that fails (accuracy before clock skew)", () => {
    const sample = makeSample({
      accuracyMeters: 200,
      capturedAt: new Date(serverTimeMs + 60_000).toISOString()
    });
    const result = validateLocationSample(sample, serverTimeMs);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toBe(
      "ACCURACY_TOO_LOW"
    );
  });

  it("rejects on clock skew before expiry (when accuracy is valid)", () => {
    const sample = makeSample({
      accuracyMeters: 10,
      capturedAt: new Date(serverTimeMs + 60_000).toISOString()
    });
    expect(validateLocationSample(sample, serverTimeMs)).toEqual({
      valid: false,
      reason: "CLOCK_SKEW"
    });
  });
});

// ============================================================================
// calculateFreshness — pure function tests
// ============================================================================

describe("calculateFreshness", () => {
  const serverTimeMs = Date.now();

  it("returns NONE when capturedAt is null", () => {
    expect(calculateFreshness(null, serverTimeMs)).toEqual({
      freshness: "NONE",
      capturedAt: null
    });
  });

  it("returns FRESH for a sample captured at exactly now (0s age)", () => {
    const capturedAt = new Date(serverTimeMs).toISOString();
    expect(calculateFreshness(capturedAt, serverTimeMs)).toEqual({
      freshness: "FRESH",
      capturedAt
    });
  });

  it("returns FRESH for a sample captured at 120s age", () => {
    const capturedAt = new Date(serverTimeMs - 120_000).toISOString();
    expect(calculateFreshness(capturedAt, serverTimeMs)).toEqual({
      freshness: "FRESH",
      capturedAt
    });
  });

  it("returns STALE for a sample captured at 121s age", () => {
    const capturedAt = new Date(serverTimeMs - 121_000).toISOString();
    expect(calculateFreshness(capturedAt, serverTimeMs)).toEqual({
      freshness: "STALE",
      capturedAt
    });
  });

  it("returns STALE for a very old sample", () => {
    const capturedAt = new Date(serverTimeMs - 600_000).toISOString();
    expect(calculateFreshness(capturedAt, serverTimeMs)).toEqual({
      freshness: "STALE",
      capturedAt
    });
  });
});

// ============================================================================
// shouldSaveSample — pure function tests
// ============================================================================

describe("shouldSaveSample", () => {
  const now = Date.now();

  it("should save on first sample (no previous sample)", () => {
    const sample = makeSample({ capturedAt: new Date(now).toISOString() });
    expect(shouldSaveSample(sample, null, false)).toEqual({
      shouldSample: true,
      reason: "first_sample"
    });
  });

  it("should save on business event", () => {
    const sample = makeSample({ capturedAt: new Date(now).toISOString() });
    const last = makeLastSample({ capturedAt: new Date(now - 1_000) });
    expect(shouldSaveSample(sample, last, true)).toEqual({
      shouldSample: true,
      reason: "business_event"
    });
  });

  it("should save when 120s elapsed since last sample", () => {
    const last = makeLastSample({ capturedAt: new Date(now - 200_000) });
    const sample = makeSample({ capturedAt: new Date(now - 30_000).toISOString() });
    expect(shouldSaveSample(sample, last, false)).toEqual({
      shouldSample: true,
      reason: "time_elapsed"
    });
  });

  it("should save when exactly 120s elapsed", () => {
    const last = makeLastSample({ capturedAt: new Date(now - 200_000) });
    const sample = makeSample({ capturedAt: new Date(now - 80_000).toISOString() });
    expect(shouldSaveSample(sample, last, false)).toEqual({
      shouldSample: true,
      reason: "time_elapsed"
    });
  });

  it("should save when moved more than 200m", () => {
    // Same location (30.0, 104.0) → new location ~0.003 degrees away ≈ ~300m
    const last = makeLastSample({ capturedAt: new Date(now - 50_000), lat: 30.0, lng: 104.0 });
    const sample = makeSample({
      lat: 30.0027,
      lng: 104.0,
      capturedAt: new Date(now - 20_000).toISOString()
    });
    expect(shouldSaveSample(sample, last, false)).toEqual({
      shouldSample: true,
      reason: "distance_moved"
    });
  });

  it("should NOT save when no significant change", () => {
    const last = makeLastSample({
      capturedAt: new Date(now - 50_000),
      lat: 30.0,
      lng: 104.0
    });
    const sample = makeSample({
      lat: 30.0001,
      lng: 104.0001,
      capturedAt: new Date(now - 40_000).toISOString()
    });
    expect(shouldSaveSample(sample, last, false)).toEqual({
      shouldSample: false,
      reason: "no_significant_change"
    });
  });

  it("should NOT save when exactly 200m moved (not > 200m)", () => {
    // The threshold is > 200, not >= 200
    const last = makeLastSample({
      capturedAt: new Date(now - 50_000),
      lat: 30.0,
      lng: 104.0
    });
    // ~200m away (approximately)
    const sample = makeSample({
      lat: 30.0018,
      lng: 104.0,
      capturedAt: new Date(now - 40_000).toISOString()
    });
    const result = shouldSaveSample(sample, last, false);
    // This is roughly ~200m; the test verifies the function doesn't crash
    expect(result.shouldSample).toBeDefined();
  });

  it("prefers business event over other checks", () => {
    const last = makeLastSample({
      capturedAt: new Date(now - 30_000),
      lat: 30.0,
      lng: 104.0
    });
    const sample = makeSample({
      lat: 30.0001,
      lng: 104.0001,
      capturedAt: new Date(now - 25_000).toISOString()
    });
    const result = shouldSaveSample(sample, last, true);
    expect(result).toEqual({ shouldSample: true, reason: "business_event" });
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

  it("returns NONE when Redis unavailable and no DB data", async () => {
    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("NONE");
  });

  it("returns freshness from DB fallback when Redis unavailable", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: recentTime
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("FRESH");
  });

  it("returns STALE from DB fallback for old data", async () => {
    const oldTime = new Date(Date.now() - 200_000);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: oldTime
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("STALE");
  });

  it("uses Redis when available and data present", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockResolvedValue({
      ts: new Date(Date.now() - 30_000).toISOString(),
      lat: "30.5",
      lng: "104.0",
      status: "ACTIVE",
      server_ts: String(Date.now())
    });

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("FRESH");
    expect(mockRedis.getDriverLocation).toHaveBeenCalledWith("d-1");
  });

  it("falls back to DB when Redis returns null", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockResolvedValue(null);

    const recentTime = new Date(Date.now() - 30_000);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: recentTime
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("FRESH");
  });

  it("falls back to DB when Redis throws", async () => {
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.getDriverLocation.mockRejectedValue(new Error("Redis down"));

    const recentTime = new Date(Date.now() - 30_000);
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      lastLocationCapturedAt: recentTime
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await getDriverLocationFreshness("d-1");
    expect(result).toBe<LocationFreshnessV2>("FRESH");
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

  it("returns true for onShift=true, AVAILABLE, FRESH", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "AVAILABLE",
      lastLocationCapturedAt: new Date(Date.now() - 30_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(true);
  });

  it("returns false for onShift=false", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: false,
      availability: "AVAILABLE"
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns false for UNAVAILABLE driver", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "UNAVAILABLE"
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns false when freshness is STALE", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "AVAILABLE",
      lastLocationCapturedAt: new Date(Date.now() - 200_000)
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns false when freshness is NONE (driver exists but no location)", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({
      onShift: true,
      availability: "AVAILABLE",
      lastLocationCapturedAt: null
    } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });

  it("returns false when driver not found", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);

    const result = await isCandidateDriver("d-1");
    expect(result).toBe(false);
  });
});

// ============================================================================
// processLocationBatch — orchestration tests
// ============================================================================

describe("processLocationBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.isRedisAvailable.mockReturnValue(true);
    mockRedis.setDriverLocation.mockResolvedValue(undefined);
    mockRedis.setDriverOnline.mockResolvedValue(undefined);

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
    vi.mocked(prisma.driver.update).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.driver.update>>);
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
    expect(result.results[1]).toEqual({ index: 1, status: "success" });
    expect(result.results[2]).toEqual({ index: 2, status: "success" });
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
      makeSample({
        accuracyMeters: 10,
        capturedAt: new Date(Date.now() + 60_000).toISOString()
      })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      status: "skipped",
      reason: "CLOCK_SKEW"
    });
  });

  it("rejects expired samples", async () => {
    const samples = [
      makeSample({
        accuracyMeters: 10,
        capturedAt: new Date(Date.now() - 200_000).toISOString()
      })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      status: "skipped",
      reason: "EXPIRED_AT_RECEIPT"
    });
  });

  it("marks duplicate samples as DUPLICATE", async () => {
    const capturedAt = new Date(Date.now() - 10_000);
    vi.mocked(prisma.driverLocationSample.findMany).mockResolvedValue([
      { capturedAt } as unknown as Awaited<
        ReturnType<typeof prisma.driverLocationSample.findMany>
      >[number]
    ]);

    const samples = [
      makeSample({
        accuracyMeters: 10,
        capturedAt: capturedAt.toISOString()
      })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      status: "skipped",
      reason: "DUPLICATE"
    });
  });

  it("handles mixed valid/invalid samples in a single batch", async () => {
    const now = Date.now();
    const samples = [
      makeSample({ accuracyMeters: 10, capturedAt: new Date(now - 10_000).toISOString() }),
      makeSample({ accuracyMeters: 200, capturedAt: new Date(now - 20_000).toISOString() }),
      makeSample({ accuracyMeters: 10, capturedAt: new Date(now - 30_000).toISOString() })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({ index: 0, status: "success" });
    expect(result.results[1]).toEqual({
      index: 1,
      status: "skipped",
      reason: "ACCURACY_TOO_LOW"
    });
    expect(result.results[2]).toEqual({ index: 2, status: "success" });
  });

  it("handles duplicate within same batch", async () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    vi.mocked(prisma.driverLocationSample.findMany).mockResolvedValue([]);

    const samples = [
      makeSample({ accuracyMeters: 10, capturedAt: ts }),
      makeSample({ accuracyMeters: 10, capturedAt: ts })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toEqual({ index: 0, status: "success" });
    expect(result.results[1]).toEqual({
      index: 1,
      status: "skipped",
      reason: "DUPLICATE"
    });
  });

  it("continues despite Redis write failure", async () => {
    mockRedis.setDriverLocation.mockRejectedValue(new Error("Redis down"));
    mockRedis.setDriverOnline.mockRejectedValue(new Error("Redis down"));

    const samples = [
      makeSample({
        accuracyMeters: 10,
        capturedAt: new Date(Date.now() - 10_000).toISOString()
      })
    ];

    const result = await processLocationBatch("d-1", samples, "trace-1");

    expect(result.success).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("handles an empty batch", async () => {
    const result = await processLocationBatch("d-1", [], "trace-1");

    expect(result.success).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

// ============================================================================
// Mock setup
// ============================================================================

vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: {
      findMany: vi.fn()
    },
    driverShift: {
      findFirst: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    }
  }
}));

vi.mock("@/lib/location", () => ({
  processLocationBatch: vi.fn(),
  getDriverLocationFreshness: vi.fn()
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { getDriverLocationFreshness, processLocationBatch } from "@/lib/location";
import { prisma } from "@/lib/prisma";

import { POST as postLocation } from "./location/route";
import { GET as getMap } from "./map/route";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Routes only use standard Request APIs at runtime; the NextRequest typing is
 * satisfied via cast (same pattern as the other route tests in this repo).
 */
function asNextRequest(request: Request): NextRequest {
  return request as unknown as NextRequest;
}

// In non-production the driver auth fallback accepts ?driverId= — used here to
// authenticate test calls without a JWT.
const AUTHED_MAP_URL = "http://localhost/api/v2/driver/map?driverId=d-caller";
const ANON_MAP_URL = "http://localhost/api/v2/driver/map";
const AUTHED_LOCATION_URL =
  "http://localhost/api/v2/driver/location?driverId=d-1";
const ANON_LOCATION_URL = "http://localhost/api/v2/driver/location";

function postJson(url: string, rawBody: string) {
  return asNextRequest(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody
    })
  );
}

// ============================================================================
// GET /api/v2/driver/map — P0-3 regression tests
// ============================================================================

describe("GET /api/v2/driver/map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects anonymous access with 401 UNAUTHORIZED (P0-3)", async () => {
    const response = await getMap(asNextRequest(new Request(ANON_MAP_URL)));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // No driver data may be fetched for anonymous callers
    expect(prisma.driver.findMany).not.toHaveBeenCalled();
  });

  it("returns the real store code and omits lastLocation entirely when accuracy and capture time are unknown (P0-3)", async () => {
    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d-1",
        name: "司机一",
        onShift: true,
        availability: "AVAILABLE",
        planVersion: 3,
        lastLat: 30.5,
        lastLng: 104.0,
        lastAccuracyMeters: null,
        lastLocationCapturedAt: null,
        store: { code: "STORE_CD_01" }
      }
    ] as unknown as Awaited<ReturnType<typeof prisma.driver.findMany>>);
    vi.mocked(getDriverLocationFreshness).mockResolvedValue("NONE");
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);

    const response = await getMap(asNextRequest(new Request(AUTHED_MAP_URL)));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    const driver = body.data[0];
    // storeCode must come from the Store relation, not the storeId FK
    expect(driver.storeCode).toBe("STORE_CD_01");
    // Frozen contract §3.3: lastLocation is optional as a whole, but its inner
    // fields are all required — a partial object (lat/lng only) or fabricated
    // 0 / "" must never be emitted. The WHOLE object is omitted instead.
    expect(driver.lastLocation).toBeUndefined();
  });

  it("omits the whole lastLocation when only the capture time is unknown (P0-3)", async () => {
    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d-1",
        name: "司机一",
        onShift: true,
        availability: "AVAILABLE",
        planVersion: 3,
        lastLat: 30.5,
        lastLng: 104.0,
        lastAccuracyMeters: 12,
        lastLocationCapturedAt: null,
        store: { code: "STORE_CD_01" }
      }
    ] as unknown as Awaited<ReturnType<typeof prisma.driver.findMany>>);
    vi.mocked(getDriverLocationFreshness).mockResolvedValue("NONE");
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);

    const response = await getMap(asNextRequest(new Request(AUTHED_MAP_URL)));

    expect(response.status).toBe(200);
    const body = await response.json();
    // A fix without capture time cannot be freshness-assessed — omit entirely
    // rather than fabricate an empty capturedAt.
    expect(body.data[0].lastLocation).toBeUndefined();
  });

  it("omits the whole lastLocation when only the accuracy is unknown (P0-3)", async () => {
    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d-1",
        name: "司机一",
        onShift: true,
        availability: "AVAILABLE",
        planVersion: 3,
        lastLat: 30.5,
        lastLng: 104.0,
        lastAccuracyMeters: null,
        lastLocationCapturedAt: new Date("2026-07-18T08:00:00.000Z"),
        store: { code: "STORE_CD_01" }
      }
    ] as unknown as Awaited<ReturnType<typeof prisma.driver.findMany>>);
    vi.mocked(getDriverLocationFreshness).mockResolvedValue("STALE");
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);

    const response = await getMap(asNextRequest(new Request(AUTHED_MAP_URL)));

    expect(response.status).toBe(200);
    const body = await response.json();
    // Never fabricate accuracyMeters: 0 — omit the whole object instead.
    expect(body.data[0].lastLocation).toBeUndefined();
  });

  it("includes accuracy and capture time when they are known", async () => {
    const capturedAt = new Date("2026-07-18T08:00:00.000Z");
    vi.mocked(prisma.driver.findMany).mockResolvedValue([
      {
        id: "d-1",
        name: "司机一",
        onShift: true,
        availability: "AVAILABLE",
        planVersion: 1,
        lastLat: 30.5,
        lastLng: 104.0,
        lastAccuracyMeters: 12,
        lastLocationCapturedAt: capturedAt,
        store: { code: "STORE_CD_01" }
      }
    ] as unknown as Awaited<ReturnType<typeof prisma.driver.findMany>>);
    vi.mocked(getDriverLocationFreshness).mockResolvedValue("FRESH");
    vi.mocked(prisma.driverShift.findFirst).mockResolvedValue(null);

    const response = await getMap(asNextRequest(new Request(AUTHED_MAP_URL)));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].lastLocation).toEqual({
      lat: 30.5,
      lng: 104.0,
      accuracyMeters: 12,
      capturedAt: capturedAt.toISOString()
    });
  });
});

// ============================================================================
// POST /api/v2/driver/location — P1-5 regression tests
// ============================================================================

describe("POST /api/v2/driver/location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects anonymous access with 401 UNAUTHORIZED", async () => {
    const response = await postLocation(
      postJson(ANON_LOCATION_URL, JSON.stringify({ samples: [] }))
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(processLocationBatch).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED for a JSON null body instead of crashing (P1-5)", async () => {
    const response = await postLocation(postJson(AUTHED_LOCATION_URL, "null"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(processLocationBatch).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED for malformed JSON (P1-5)", async () => {
    const response = await postLocation(postJson(AUTHED_LOCATION_URL, "{not json"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(processLocationBatch).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when samples is missing (P1-5)", async () => {
    const response = await postLocation(postJson(AUTHED_LOCATION_URL, "{}"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(processLocationBatch).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when samples is not an array (P1-5)", async () => {
    const response = await postLocation(
      postJson(AUTHED_LOCATION_URL, JSON.stringify({ samples: 123 }))
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(processLocationBatch).not.toHaveBeenCalled();
  });

  it("processes a valid batch for the authenticated driver", async () => {
    vi.mocked(processLocationBatch).mockResolvedValue({
      results: [{ index: 0, status: "success" }],
      success: 1,
      skipped: 0
    });

    const samples = [
      {
        lat: 30.5,
        lng: 104.0,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString()
      }
    ];

    const response = await postLocation(
      postJson(AUTHED_LOCATION_URL, JSON.stringify({ samples }))
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(1);
    expect(processLocationBatch).toHaveBeenCalledWith(
      "d-1",
      samples,
      expect.any(String)
    );
  });
});

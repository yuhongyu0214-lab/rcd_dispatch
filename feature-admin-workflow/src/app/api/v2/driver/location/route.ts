import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { processLocationBatch } from "@/lib/location";
import { extractDriverId } from "../../../driver/_utils";

import type { LocationBatchV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/driver/location
 *
 * Batch location upload from the driver client.
 * Accepts an array of location samples; validates each independently.
 * One rejection does NOT block other samples in the batch.
 *
 * Returns LocationBatchResultV2 with per-sample results.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // Auth: extract driver identity from JWT or session cookie
  const driverId = await extractDriverId(request);

  if (!driverId) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Driver authentication required"),
      { traceId }
    );
  }

  // Parse request body
  let body: LocationBatchV2;
  try {
    body = (await request.json()) as LocationBatchV2;
  } catch {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Invalid JSON body",
        { fields: { body: ["Expected valid JSON"] } }
      ),
      { traceId }
    );
  }

  if (!body.samples || !Array.isArray(body.samples)) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Missing or invalid samples array",
        { fields: { samples: ["Expected non-empty array"] } }
      ),
      { traceId }
    );
  }

  const result = await processLocationBatch(driverId, body.samples, traceId);

  return okV2(result, { traceId });
}

import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { DbClaimFailedError, processLocationBatch } from "@/lib/location";
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

  // Parse request body (P1-5: a JSON body of `null` or a non-object must
  // return a structured 400 instead of crashing on `body.samples`).
  let body: unknown;
  try {
    body = await request.json();
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

  if (body === null || typeof body !== "object") {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Request body must be a JSON object",
        { fields: { body: ["Expected a JSON object with a samples array"] } }
      ),
      { traceId }
    );
  }

  const { samples } = body as Partial<LocationBatchV2>;

  if (!Array.isArray(samples)) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Missing or invalid samples array",
        { fields: { samples: ["Expected non-empty array"] } }
      ),
      { traceId }
    );
  }

  let result;
  try {
    result = await processLocationBatch(driverId, samples, traceId);
  } catch (err) {
    if (err instanceof DbClaimFailedError) {
      return failV2(
        createApiErrorV2(
          "INTERNAL_ERROR",
          "Database unavailable — location batch could not be processed. Retry is safe."
        ),
        { traceId }
      );
    }
    throw err;
  }

  return okV2(result, { traceId });
}

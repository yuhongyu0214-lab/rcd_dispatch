import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { startShift } from "@/lib/shifts/shift-service";
import { extractDriverId } from "../../../../driver/_utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/driver/shift/start
 *
 * Start a driver shift. Idempotent — if the driver is already on shift,
 * returns the current active shift without creating a new one.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  const driverId = await extractDriverId(request);

  if (!driverId) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Driver authentication required"),
      { traceId }
    );
  }

  const result = await startShift(driverId, traceId);

  if (!result.success) {
    return failV2(result.error, { traceId });
  }

  return okV2(
    {
      shiftId: result.shift.id,
      driverId: result.shift.driverId,
      startedAt: result.shift.startedAt.toISOString()
    },
    { traceId }
  );
}

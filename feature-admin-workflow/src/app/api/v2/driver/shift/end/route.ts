import { NextRequest } from "next/server";

import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { endShift } from "@/lib/shifts/shift-service";
import { extractDriverId } from "../../../../driver/_utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/driver/shift/end
 *
 * End a driver shift. Guarded by execution check — cannot end shift
 * if the driver has active EN_ROUTE or IN_SERVICE orders.
 * PLANNED assignments are released (order → UNASSIGNED, removed from plan).
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

  const result = await endShift(driverId, traceId);

  if (!result.success) {
    return failV2(result.error, { traceId });
  }

  return okV2(
    {
      shiftId: result.shift.id,
      driverId: result.shift.driverId,
      startedAt: result.shift.startedAt.toISOString(),
      endedAt: result.shift.endedAt?.toISOString() ?? null
    },
    { traceId }
  );
}

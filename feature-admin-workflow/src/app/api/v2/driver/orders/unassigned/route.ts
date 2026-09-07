import { extractDriverId } from "@/app/api/driver/_utils";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { listUnassignedOrders } from "@/lib/driver-v2/read-service";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("driver-unassigned-orders-route-v2");

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const driverId = await extractDriverId(request);
  if (!driverId) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Driver authentication required"),
      { traceId }
    );
  }

  try {
    return okV2(await listUnassignedOrders(), { traceId });
  } catch (error) {
    log.error("driver_unassigned_orders_read_failed", {
      driverId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return failV2(
      createApiErrorV2(
        "INTERNAL_ERROR",
        "Unassigned orders are temporarily unavailable"
      ),
      { traceId }
    );
  }
}

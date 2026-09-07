import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { getDriverPlan } from "@/lib/dispatcher-v2/read-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ driverId: string }> }
) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Dispatcher authentication required"),
      { traceId }
    );
  }
  if (!isAdminRole(currentUser.role)) {
    return failV2(
      createApiErrorV2("FORBIDDEN", "Dispatcher role required"),
      { traceId }
    );
  }
  const driverId = (await context.params).driverId?.trim();
  if (!driverId) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Driver ID is required", {
        fields: { driverId: ["Required"] }
      }),
      { traceId }
    );
  }
  try {
    const plan = await getDriverPlan(driverId);
    if (!plan) {
      return failV2(createApiErrorV2("NOT_FOUND", "Driver not found"), {
        traceId
      });
    }
    return okV2(plan, { traceId });
  } catch {
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read driver plan"),
      { traceId }
    );
  }
}

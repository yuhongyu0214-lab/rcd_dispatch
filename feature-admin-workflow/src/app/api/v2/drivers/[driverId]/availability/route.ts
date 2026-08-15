import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { setDriverAvailability } from "@/lib/dispatcher-v2/driver-command-service";

import type { SetDriverAvailabilityCommandV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

export async function PATCH(
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

  let body: Partial<SetDriverAvailabilityCommandV2>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failV2(
        createApiErrorV2(
          "VALIDATION_FAILED",
          "Request body must be a JSON object",
          { fields: { body: ["Expected valid JSON object"] } }
        ),
        { traceId }
      );
    }
    body = parsed as Partial<SetDriverAvailabilityCommandV2>;
  } catch {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Request body must be a JSON object",
        { fields: { body: ["Expected valid JSON object"] } }
      ),
      { traceId }
    );
  }
  const fields: Record<string, string[]> = {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.availability !== "AVAILABLE" && body.availability !== "UNAVAILABLE") {
    fields.availability = ["Expected AVAILABLE or UNAVAILABLE"];
  }
  if (!reason) fields.reason = ["Required"];
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid availability command", {
        fields
      }),
      { traceId }
    );
  }
  const result = await setDriverAvailability({
    driverId,
    availability: body.availability!,
    reason,
    operatorUserId: currentUser.id,
    traceId
  });
  return result.success
    ? okV2(result.data, { traceId })
    : failV2(result.error, { traceId });
}

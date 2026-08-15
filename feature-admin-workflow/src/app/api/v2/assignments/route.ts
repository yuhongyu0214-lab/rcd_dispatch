import { assignOrder } from "@/lib/assignments-v2/assignment-command-service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";

import type { AssignCommandV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  let body: Partial<AssignCommandV2>;
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
    body = parsed as Partial<AssignCommandV2>;
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
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const driverId = typeof body.driverId === "string" ? body.driverId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!orderId) fields.orderId = ["Required"];
  if (!driverId) fields.driverId = ["Required"];
  if (!reason) fields.reason = ["Required"];
  if (!Number.isSafeInteger(body.expectedPlanVersion)) {
    fields.expectedPlanVersion = ["Expected integer"];
  }
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid assignment command", {
        fields
      }),
      { traceId }
    );
  }

  const result = await assignOrder({
    orderId,
    driverId,
    reason,
    expectedPlanVersion: body.expectedPlanVersion!,
    operatorUserId: currentUser.id,
    traceId
  });
  return result.success
    ? okV2(result.data, { traceId })
    : failV2(result.error, { traceId });
}

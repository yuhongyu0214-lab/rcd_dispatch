import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { cancelOrder } from "@/lib/dispatcher-v2/order-command-service";

import type { CancelOrderCommandV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
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
  const orderId = (await context.params).orderId?.trim();
  if (!orderId) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Order ID is required", {
        fields: { orderId: ["Required"] }
      }),
      { traceId }
    );
  }

  let body: Partial<CancelOrderCommandV2> & {
    expectedPlanVersion?: unknown;
  };
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
    body = parsed as Partial<CancelOrderCommandV2> & {
      expectedPlanVersion?: unknown;
    };
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
  if (Object.prototype.hasOwnProperty.call(body, "expectedPlanVersion")) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid cancellation command", {
        fields: { expectedPlanVersion: ["Must not be provided"] }
      }),
      { traceId }
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid cancellation command", {
        fields: { reason: ["Required"] }
      }),
      { traceId }
    );
  }
  const result = await cancelOrder({
    orderId,
    reason,
    operatorUserId: currentUser.id,
    traceId
  });
  return result.success
    ? okV2(result.data, { traceId })
    : failV2(result.error, { traceId });
}

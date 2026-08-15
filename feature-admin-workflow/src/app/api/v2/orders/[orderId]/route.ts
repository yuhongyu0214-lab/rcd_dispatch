import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { updateOrder } from "@/lib/dispatcher-v2/order-command-service";
import { getOrderDetail } from "@/lib/dispatcher-v2/read-service";

import type { UpdateOrderCommandV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

async function authorize(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return {
      ok: false as const,
      response: failV2(
        createApiErrorV2("UNAUTHORIZED", "Dispatcher authentication required"),
        { traceId }
      ),
      traceId
    };
  }
  if (!isAdminRole(currentUser.role)) {
    return {
      ok: false as const,
      response: failV2(
        createApiErrorV2("FORBIDDEN", "Dispatcher role required"),
        { traceId }
      ),
      traceId
    };
  }
  return { ok: true as const, currentUser, traceId };
}

async function orderIdFrom(context: Context) {
  return (await context.params).orderId?.trim();
}

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const orderId = await orderIdFrom(context);
  if (!orderId) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Order ID is required", {
        fields: { orderId: ["Required"] }
      }),
      { traceId: auth.traceId }
    );
  }
  try {
    const detail = await getOrderDetail(orderId);
    if (!detail) {
      return failV2(createApiErrorV2("NOT_FOUND", "Order not found"), {
        traceId: auth.traceId
      });
    }
    return okV2(detail, { traceId: auth.traceId });
  } catch {
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read order"),
      { traceId: auth.traceId }
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const orderId = await orderIdFrom(context);
  if (!orderId) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Order ID is required", {
        fields: { orderId: ["Required"] }
      }),
      { traceId: auth.traceId }
    );
  }

  let body: Partial<UpdateOrderCommandV2>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failV2(
        createApiErrorV2(
          "VALIDATION_FAILED",
          "Request body must be a JSON object",
          { fields: { body: ["Expected valid JSON object"] } }
        ),
        { traceId: auth.traceId }
      );
    }
    body = parsed as Partial<UpdateOrderCommandV2>;
  } catch {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Request body must be a JSON object",
        { fields: { body: ["Expected valid JSON object"] } }
      ),
      { traceId: auth.traceId }
    );
  }

  const fields: Record<string, string[]> = {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) fields.reason = ["Required"];
  const promisedPickupAt = body.promisedPickupAt;
  if (promisedPickupAt !== undefined) {
    if (
      typeof promisedPickupAt !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(promisedPickupAt) ||
      !Number.isFinite(Date.parse(promisedPickupAt))
    ) {
      fields.promisedPickupAt = ["Expected ISO 8601 datetime with timezone"];
    }
  }
  const pickupAddress =
    typeof body.pickupAddress === "string" ? body.pickupAddress.trim() : undefined;
  const deliveryAddress =
    typeof body.deliveryAddress === "string"
      ? body.deliveryAddress.trim()
      : undefined;
  if (body.pickupAddress !== undefined && !pickupAddress) {
    fields.pickupAddress = ["Expected non-empty string"];
  }
  if (body.deliveryAddress !== undefined && !deliveryAddress) {
    fields.deliveryAddress = ["Expected non-empty string"];
  }
  if (
    promisedPickupAt === undefined &&
    body.pickupAddress === undefined &&
    body.deliveryAddress === undefined
  ) {
    fields.body = ["At least one editable order field is required"];
  }
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid order update", {
        fields
      }),
      { traceId: auth.traceId }
    );
  }

  const result = await updateOrder({
    orderId,
    promisedPickupAt: promisedPickupAt
      ? new Date(promisedPickupAt).toISOString()
      : undefined,
    pickupAddress,
    deliveryAddress,
    reason,
    operatorUserId: auth.currentUser.id,
    traceId: auth.traceId
  });
  return result.success
    ? okV2(result.data, { traceId: auth.traceId })
    : failV2(result.error, { traceId: auth.traceId });
}

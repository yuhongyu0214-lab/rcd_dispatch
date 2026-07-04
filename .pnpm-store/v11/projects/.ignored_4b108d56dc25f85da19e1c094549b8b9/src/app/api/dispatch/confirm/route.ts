import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { confirmRecommendedDispatch } from "@/lib/dispatch/confirm";
import { createLogger } from "@/lib/logger";

type ConfirmRequestBody = {
  orderId?: string;
  driverId?: string;
};

const dispatchApiLog = createLogger("dispatch-rule-v1");

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("当前账号无权限确认推荐派单", { status: 403, traceId });
  }

  let body: ConfirmRequestBody;

  try {
    body = (await request.json()) as ConfirmRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();
  const driverId = body.driverId?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  if (!driverId) {
    return fail("请选择推荐司机", { status: 400, traceId });
  }

  try {
    const result = await confirmRecommendedDispatch({
      orderId,
      driverId,
      operatorUserId: currentUser.id,
      traceId
    });

    if (!result.success) {
      dispatchApiLog.warn("dispatch_confirm_failed", {
        traceId,
        orderId,
        driverId,
        reason: result.error,
        status: String(result.status)
      });

      // 409 Conflict: order was claimed by another dispatcher or status changed
      // Frontend should auto-refresh the recommendation list
      if (result.status === 409) {
        return fail(result.error, {
          status: 409,
          traceId,
          headers: {
            "X-Conflict-Reason": "order-claimed",
            "X-Action": "refresh"
          }
        } as ResponseInit & { traceId: string });
      }

      return fail(result.error, { status: result.status, traceId });
    }

    dispatchApiLog.info("dispatch_confirm_succeeded", {
      traceId,
      orderId,
      driverId,
      assignmentId: result.data.assignment.id
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "确认推荐派单失败";
    dispatchApiLog.error("dispatch_confirm_error", {
      traceId,
      orderId,
      driverId,
      error: message
    });
    return fail(message, { status: 500, traceId });
  }
}

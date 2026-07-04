import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { confirmRecommendedDispatch } from "@/lib/dispatch/confirm";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";

type ConfirmRequestBody = {
  orderId?: string;
  driverId?: string;
};

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
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
      logger.warn({ traceId, orderId, driverId, reason: result.error }, "confirm_blocked");
      return fail(result.error, { status: result.status, traceId });
    }

    logger.info({ traceId, orderId, driverId, outcome: "success" }, "confirm_finished");
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "确认推荐派单失败";
    logger.error({ traceId, orderId, driverId, error: message }, "confirm_failed");
    return fail(message, { status: 500, traceId });
  }
}

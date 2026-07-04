import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { runDispatch } from "@/lib/dispatch/engine";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

type RecommendRequestBody = {
  orderId?: string;
  topN?: number;
};

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限运行推荐派单", { status: 403, traceId });
  }

  let body: RecommendRequestBody;

  try {
    body = (await request.json()) as RecommendRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  const topN = Number.isInteger(body.topN) ? Math.min(Math.max(body.topN ?? 3, 1), 10) : 3;

  try {
    const result = await runDispatch(orderId, topN, traceId);

    if (result.orderNo === "") {
      logger.warn({ traceId, orderId }, "recommend_no_order");
      return fail("订单不存在", { status: 404, traceId });
    }

    if (result.outcome === "DISPATCHED") {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "RECOMMENDING" }
      });
    }

    logger.info({
      traceId,
      orderId,
      orderNo: result.orderNo,
      outcome: result.outcome,
      reason: result.reason ?? "none",
      candidateCount: result.topN.length
    }, "recommend_finished");

    return ok(result, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "推荐派单运行失败";
    logger.error({ traceId, orderId, error: message }, "recommend_failed");
    return fail(message, { status: 500, traceId });
  }
}

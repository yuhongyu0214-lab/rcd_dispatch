import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

type WithdrawRequestBody = {
  orderId?: string;
  reason?: string;
};

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限执行撤回", { status: 403, traceId });
  }

  let body: WithdrawRequestBody;

  try {
    body = (await request.json()) as WithdrawRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();
  const reason = body.reason?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  logger.info({ traceId, orderId }, "withdraw_started");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          currentAssignment: {
            include: {
              driver: { select: { id: true, name: true } }
            }
          }
        }
      });

      if (!order) {
        throw new Prisma.PrismaClientKnownRequestError("订单不存在", {
          code: "RCD_NOT_FOUND",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      if (order.status !== "ASSIGNED") {
        throw new Prisma.PrismaClientKnownRequestError("只有已派单订单可以撤回", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      if (!order.currentAssignment) {
        throw new Prisma.PrismaClientKnownRequestError("订单缺少当前派单记录", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      await tx.assignment.update({
        where: { id: order.currentAssignment.id },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: new Date()
        }
      });

      await tx.driver.update({
        where: { id: order.currentAssignment.driverId },
        data: { status: "S1" }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PENDING",
          currentAssignmentId: null,
          driverNameSnapshot: null
        }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: order.id,
          action: "WITHDRAW",
          operatorUserId: currentUser.id,
          reason: reason || null,
          metadataJson: {
            traceId,
            orderNo: order.orderNo,
            assignmentId: order.currentAssignment.id,
            driverId: order.currentAssignment.driverId,
            driverName: order.currentAssignment.driver.name,
            stateFlow: ["ASSIGNED", "RECYCLED", "PENDING"]
          }
        }
      });

      return { order: updatedOrder };
    }, { timeout: 15000 });

    logger.info({ traceId, orderId, outcome: "success" }, "withdraw_finished");
    return ok(result, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "撤回失败";
    logger.error({ traceId, orderId, error: message }, "withdraw_failed");
    const status = message.includes("不存在") ? 404 : 400;
    return fail(message, { status, traceId });
  }
}

import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

type AssignRequestBody = {
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
    return fail("当前账号无权限执行派单", { status: 403, traceId });
  }

  let body: AssignRequestBody;

  try {
    body = (await request.json()) as AssignRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();
  const driverId = body.driverId?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  if (!driverId) {
    return fail("请选择司机", { status: 400, traceId });
  }

  logger.info({ traceId, orderId, driverId, type: "MANUAL" }, "assign_started");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNo: true,
          status: true,
          currentAssignmentId: true
        }
      });

      if (!order) {
        throw new Prisma.PrismaClientKnownRequestError("订单不存在", {
          code: "RCD_NOT_FOUND",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      if (order.status !== "PENDING") {
        throw new Prisma.PrismaClientKnownRequestError("只有待分配订单可以派单", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: {
          id: true,
          name: true,
          status: true,
          isActive: true
        }
      });

      if (!driver || !driver.isActive) {
        throw new Prisma.PrismaClientKnownRequestError("司机不存在或已停用", {
          code: "RCD_NOT_FOUND",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      if (driver.status === "OFFLINE" || driver.status === "UNAVAILABLE") {
        throw new Prisma.PrismaClientKnownRequestError("该司机当前不参与调度", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      const assignment = await tx.assignment.create({
        data: {
          orderId: order.id,
          driverId: driver.id,
          type: "MANUAL_ASSIGN",
          status: "ACTIVE",
          createdByUserId: currentUser.id
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "ASSIGNED",
          currentAssignmentId: assignment.id,
          driverNameSnapshot: driver.name
        }
      });

      await tx.driver.update({
        where: { id: driver.id },
        data: { status: "S3" }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: order.id,
          action: "ASSIGN",
          operatorUserId: currentUser.id,
          metadataJson: {
            traceId,
            orderNo: order.orderNo,
            driverId: driver.id,
            driverName: driver.name,
            fromStatus: order.status,
            toStatus: updatedOrder.status
          }
        }
      });

      return { order: updatedOrder, assignment };
    }, { timeout: 15000 });

    logger.info({ traceId, orderId, driverId, outcome: "success" }, "assign_finished");
    return ok(result, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "派单失败";
    logger.error({ traceId, orderId, driverId, error: message }, "assign_failed");
    const status = message.includes("不存在") ? 404 : 400;
    return fail(message, { status, traceId });
  }
}

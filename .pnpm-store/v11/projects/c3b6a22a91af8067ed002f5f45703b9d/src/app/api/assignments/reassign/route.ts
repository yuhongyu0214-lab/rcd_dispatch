import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

type ReassignRequestBody = {
  orderId?: string;
  driverId?: string;
  reason?: string;
};

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限执行改派", { status: 403, traceId });
  }

  let body: ReassignRequestBody;

  try {
    body = (await request.json()) as ReassignRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();
  const driverId = body.driverId?.trim();
  const reason = body.reason?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  if (!driverId) {
    return fail("请选择新司机", { status: 400, traceId });
  }

  if (!reason) {
    return fail("请输入改派原因", { status: 400, traceId });
  }

  logger.info({ traceId, orderId, driverId }, "reassign_started");

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

      if (order.status !== "ASSIGNED" && order.status !== "ACCEPTED") {
        throw new Prisma.PrismaClientKnownRequestError("只有已派单或已接单订单可以改派", {
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

      if (order.currentAssignment.driverId === driverId) {
        throw new Prisma.PrismaClientKnownRequestError("新司机不能与当前司机相同", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      const nextDriver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { id: true, name: true, status: true, isActive: true }
      });

      if (!nextDriver || !nextDriver.isActive) {
        throw new Prisma.PrismaClientKnownRequestError("新司机不存在或已停用", {
          code: "RCD_NOT_FOUND",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      if (nextDriver.status === "OFFLINE" || nextDriver.status === "UNAVAILABLE") {
        throw new Prisma.PrismaClientKnownRequestError("新司机当前不参与调度", {
          code: "RCD_INVALID_STATE",
          clientVersion: Prisma.prismaVersion.client
        });
      }

      await tx.assignment.update({
        where: { id: order.currentAssignment.id },
        data: {
          status: "RECYCLED",
          recycledAt: new Date()
        }
      });

      await tx.driver.update({
        where: { id: order.currentAssignment.driverId },
        data: { status: "S1" }
      });

      const nextAssignment = await tx.assignment.create({
        data: {
          orderId: order.id,
          driverId: nextDriver.id,
          type: "REASSIGN",
          status: "ACTIVE",
          previousAssignmentId: order.currentAssignment.id,
          createdByUserId: currentUser.id
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "ASSIGNED",
          currentAssignmentId: nextAssignment.id,
          driverNameSnapshot: nextDriver.name
        }
      });

      await tx.driver.update({
        where: { id: nextDriver.id },
        data: { status: "S3" }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: order.id,
          action: "REASSIGN",
          operatorUserId: currentUser.id,
          reason,
          metadataJson: {
            traceId,
            orderNo: order.orderNo,
            fromDriverId: order.currentAssignment.driverId,
            fromDriverName: order.currentAssignment.driver.name,
            toDriverId: nextDriver.id,
            toDriverName: nextDriver.name,
            previousAssignmentId: order.currentAssignment.id,
            nextAssignmentId: nextAssignment.id
          }
        }
      });

      return { order: updatedOrder, assignment: nextAssignment };
    }, { timeout: 15000 });

    logger.info({ traceId, orderId, driverId, outcome: "success" }, "reassign_finished");
    return ok(result, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "改派失败";
    logger.error({ traceId, orderId, driverId, error: message }, "reassign_failed");
    const status = message.includes("不存在") ? 404 : 400;
    return fail(message, { status, traceId });
  }
}

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

type AcceptRequestBody = {
  orderId?: string;
};

type AcceptTransactionResult =
  | {
      success: true;
      data: {
        order: {
          id: string;
          status: string;
        };
        assignment: {
          id: string;
          status: string;
        };
      };
    }
  | {
      success: false;
      message: string;
      status: number;
      currentStatus?: string;
    };

const workflowLog = createLogger("admin-workflow");

export async function POST(request: Request) {
  const startTime = Date.now();
  const traceId = crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限确认接单", { status: 403, traceId });
  }

  let body: AcceptRequestBody;

  try {
    body = (await request.json()) as AcceptRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const orderId = body.orderId?.trim();

  if (!orderId) {
    return fail("请选择订单", { status: 400, traceId });
  }

  try {
    const result = await prisma.$transaction<AcceptTransactionResult>(
      async (tx) => {
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
          return { success: false, message: "订单不存在", status: 404 };
        }

        if (order.status !== "ASSIGNED") {
          return {
            success: false,
            message: `订单状态不允许确认接单（当前状态: ${order.status}，仅 ASSIGNED 可接单）`,
            status: 409,
            currentStatus: order.status
          };
        }

        if (!order.currentAssignment) {
          return {
            success: false,
            message: "订单缺少当前派单记录",
            status: 409,
            currentStatus: order.status
          };
        }

        if (order.currentAssignment.status !== "ACTIVE") {
          return {
            success: false,
            message: `当前派单已非活跃状态（派单状态: ${order.currentAssignment.status}），无法确认接单`,
            status: 409,
            currentStatus: order.status
          };
        }

        const assignment = await tx.assignment.update({
          where: { id: order.currentAssignment.id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date()
          },
          select: { id: true, status: true }
        });

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "ACCEPTED" },
          select: { id: true, status: true }
        });

        await tx.driver.update({
          where: { id: order.currentAssignment.driverId },
          data: { status: "S4" }
        });

        await tx.operationLog.create({
          data: {
            entityType: "ORDER",
            entityId: order.id,
            action: "ACCEPT",
            operatorUserId: currentUser.id,
            metadataJson: {
              traceId,
              orderNo: order.orderNo,
              assignmentId: order.currentAssignment.id,
              driverId: order.currentAssignment.driverId,
              driverName: order.currentAssignment.driver.name,
              fromStatus: order.status,
              toStatus: updatedOrder.status
            }
          }
        });

        return {
          success: true,
          data: {
            order: updatedOrder,
            assignment
          }
        };
      },
      { timeout: 15000 }
    );

    if (!result.success) {
      workflowLog.warn("assignment_failed", {
        traceId,
        action: "ACCEPT",
        orderId,
        reason: result.message,
        currentStatus: result.currentStatus,
        operator: currentUser.email,
        elapsedMs: Date.now() - startTime
      });
      return fail(result.message, { status: result.status, traceId });
    }

    workflowLog.info("assignment_succeeded", {
      traceId,
      action: "ACCEPT",
      orderId,
      operator: currentUser.email,
      elapsedMs: Date.now() - startTime
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "接单确认失败";
    workflowLog.error("assignment_error", {
      traceId,
      action: "ACCEPT",
      orderId,
      operator: currentUser.email,
      error: message,
      elapsedMs: Date.now() - startTime
    });
    return fail(message, { status: 500, traceId });
  }
}

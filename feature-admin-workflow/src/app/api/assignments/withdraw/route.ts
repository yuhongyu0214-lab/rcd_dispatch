import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

type WithdrawRequestBody = {
  orderId?: string;
  reason?: string;
};

type WithdrawTransactionResult =
  | {
      success: true;
      data: unknown;
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

  try {
    const result = await prisma.$transaction<WithdrawTransactionResult>(
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
            message: `订单状态不允许撤回（当前状态: ${order.status}，仅 ASSIGNED 可撤回）`,
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
            message: `当前派单已非活跃状态（派单状态: ${order.currentAssignment.status}），无法撤回`,
            status: 409,
            currentStatus: order.status
          };
        }

        await tx.assignment.update({
          where: { id: order.currentAssignment.id },
          data: {
            status: "RECYCLED",
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

        return { success: true, data: { order: updatedOrder } };
      },
      { timeout: 15000 }
    );

    if (!result.success) {
      workflowLog.warn("assignment_failed", {
        traceId,
        action: "WITHDRAW",
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
      action: "WITHDRAW",
      orderId,
      operator: currentUser.email,
      elapsedMs: Date.now() - startTime
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "撤回失败";
    workflowLog.error("assignment_error", {
      traceId,
      action: "WITHDRAW",
      orderId,
      operator: currentUser.email,
      error: message,
      elapsedMs: Date.now() - startTime
    });
    return fail(message, { status: 500, traceId });
  }
}

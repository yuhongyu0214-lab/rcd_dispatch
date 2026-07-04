import { fail, ok } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { resolveSystemOperatorUserId } from "../../../_utils";

export const dynamic = "force-dynamic";

type DriverCompleteBody = {
  driverId?: string;
};

type DriverCompleteResult =
  | {
      success: true;
      data: {
        order: { id: string; status: string };
        assignment: { id: string; status: string };
      };
    }
  | {
      success: false;
      message: string;
      status: number;
    };

const driverLog = createLogger("driver-workflow");

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const orderId = context.params.id.trim();

  let body: DriverCompleteBody;

  try {
    body = (await request.json()) as DriverCompleteBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const driverId = body.driverId?.trim();

  if (!orderId) {
    return fail("请提供订单 ID", { status: 400, traceId });
  }

  if (!driverId) {
    return fail("请提供司机 ID", { status: 400, traceId });
  }

  try {
    const result = await prisma.$transaction<DriverCompleteResult>(
      async (tx) => {
        const operatorUserId = await resolveSystemOperatorUserId(tx);

        if (!operatorUserId) {
          return { success: false, message: "缺少系统操作员账号", status: 500 };
        }

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

        if (order.status !== "ACCEPTED" && order.status !== "IN_PROGRESS") {
          return {
            success: false,
            message: "只有已接单或执行中订单可以完成",
            status: 400
          };
        }

        if (!order.currentAssignment || order.currentAssignment.driverId !== driverId) {
          return {
            success: false,
            message: "该订单不属于当前司机",
            status: 403
          };
        }

        const assignment = await tx.assignment.update({
          where: { id: order.currentAssignment.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date()
          },
          select: { id: true, status: true }
        });

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "COMPLETED" },
          select: { id: true, status: true }
        });

        await tx.driver.update({
          where: { id: driverId },
          data: { status: "S1" }
        });

        await tx.operationLog.create({
          data: {
            entityType: "ORDER",
            entityId: order.id,
            action: "COMPLETE",
            operatorUserId,
            metadataJson: {
              traceId,
              actor: "DRIVER_API",
              orderNo: order.orderNo,
              assignmentId: order.currentAssignment.id,
              driverId,
              driverName: order.currentAssignment.driver.name,
              fromStatus: order.status,
              toStatus: updatedOrder.status
            }
          }
        });

        return { success: true, data: { order: updatedOrder, assignment } };
      },
      { timeout: 15000 }
    );

    if (!result.success) {
      driverLog.warn("driver_task_failed", {
        traceId,
        action: "COMPLETE",
        orderId,
        driverId,
        reason: result.message
      });
      return fail(result.message, { status: result.status, traceId });
    }

    driverLog.info("driver_task_succeeded", {
      traceId,
      action: "COMPLETE",
      orderId,
      driverId
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "司机完单失败";
    driverLog.error("driver_task_error", {
      traceId,
      action: "COMPLETE",
      orderId,
      driverId,
      error: message
    });
    return fail(message, { status: 500, traceId });
  }
}

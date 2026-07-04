/**
 * POST /api/driver/tasks/[id]/complete — 司机完成任务。
 *
 * order IN_PROGRESS → COMPLETED，assignment ACCEPTED → COMPLETED，driver → S1。
 * V1 使用 x-driver-id 请求头标识司机身份（真实接入时替换为司机端 Token）。
 */
import { fail, ok } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const traceId = getTraceId(request);
  const driverId = request.headers.get("x-driver-id")?.trim();
  const assignmentId = params.id;

  if (!driverId) {
    return fail("缺少司机身份标识（x-driver-id 请求头）", { status: 401, traceId });
  }

  if (!assignmentId) {
    return fail("缺少任务 ID", { status: 400, traceId });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          order: { select: { id: true, orderNo: true, status: true } },
          driver: { select: { id: true, name: true, status: true } }
        }
      });

      if (!assignment) {
        return { status: 404 as const, error: "任务不存在" };
      }

      if (assignment.driverId !== driverId) {
        return { status: 403 as const, error: "此任务不属于当前司机" };
      }

      if (assignment.status !== "ACCEPTED") {
        return {
          status: 400 as const,
          error: `任务状态为 ${assignment.status}，无法完成（仅 ACCEPTED 状态可完成）`
        };
      }

      if (assignment.order.status !== "IN_PROGRESS") {
        return {
          status: 400 as const,
          error: `订单状态为 ${assignment.order.status}，无法完成（仅 IN_PROGRESS 状态可完成）`
        };
      }

      const now = new Date();

      const updatedAssignment = await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: "COMPLETED",
          completedAt: now
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: assignment.order.id },
        data: {
          status: "COMPLETED",
          currentAssignmentId: null
        }
      });

      const updatedDriver = await tx.driver.update({
        where: { id: driverId },
        data: { status: "S1" }
      });

      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: assignment.order.id,
          action: "COMPLETE",
          operatorUserId: driverId,
          metadataJson: {
            traceId,
            orderNo: assignment.order.orderNo,
            driverId,
            driverName: assignment.driver.name,
            assignmentId,
            fromStatus: "IN_PROGRESS",
            toStatus: updatedOrder.status
          }
        }
      });

      return {
        status: 200 as const,
        data: {
          assignment: { id: updatedAssignment.id, status: updatedAssignment.status },
          order: { id: updatedOrder.id, orderNo: assignment.order.orderNo, status: updatedOrder.status },
          driver: { id: updatedDriver.id, name: updatedDriver.name, status: updatedDriver.status }
        }
      };
    }, { timeout: 10000 });

    if ("error" in result) {
      logger.warn({
        traceId,
        driverId,
        assignmentId,
        reason: result.error!
      }, "driver_complete_blocked");
      return fail(result.error!, { status: result.status, traceId });
    }

    logger.info({
      traceId,
      driverId,
      assignmentId,
      orderNo: result.data.order.orderNo
    }, "driver_complete_finished");

    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "完成任务失败";
    logger.error({ traceId, driverId, assignmentId, error: message }, "driver_complete_failed");
    return fail(message, { status: 500, traceId });
  }
}

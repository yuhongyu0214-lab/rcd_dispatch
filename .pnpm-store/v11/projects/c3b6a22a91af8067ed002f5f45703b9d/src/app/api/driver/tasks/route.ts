/**
 * GET /api/driver/tasks — 获取当前司机的任务列表。
 *
 * V1 使用 x-driver-id 请求头标识司机身份（真实接入时替换为司机端 Token）。
 */
import { fail, ok } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  const driverId = request.headers.get("x-driver-id")?.trim();

  if (!driverId) {
    return fail("缺少司机身份标识（x-driver-id 请求头）", { status: 401, traceId });
  }

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, status: true, isActive: true }
    });

    if (!driver) {
      return fail("司机不存在", { status: 404, traceId });
    }

    if (!driver.isActive) {
      return fail("司机账号已停用", { status: 403, traceId });
    }

    const tasks = await prisma.assignment.findMany({
      where: {
        driverId,
        status: { in: ["ACTIVE", "ACCEPTED"] }
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            type: true,
            status: true,
            pickupAddress: true,
            returnAddress: true,
            scheduledAt: true,
            licensePlateSnapshot: true,
            store: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { assignedAt: "desc" }
    });

    logger.info({
      traceId,
      driverId,
      driverName: driver.name,
      taskCount: tasks.length
    }, "driver_tasks_listed");

    return ok({ driver, tasks }, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取任务列表失败";
    logger.error({ traceId, driverId, error: message }, "driver_tasks_failed");
    return fail(message, { status: 500, traceId });
  }
}

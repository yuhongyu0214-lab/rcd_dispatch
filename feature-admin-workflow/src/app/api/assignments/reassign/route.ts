import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireDispatchLock, releaseDispatchLock } from "@/lib/redis";

type ReassignRequestBody = {
  orderId?: string;
  driverId?: string;
  reason?: string;
};

type ReassignTransactionResult =
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

const ALLOWED_REASSIGN_STATUSES = new Set(["ASSIGNED", "ACCEPTED"]);
const workflowLog = createLogger("admin-workflow");

export async function POST(request: Request) {
  const startTime = Date.now();
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
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

  // Redis 分布式锁：防止并发重复改派
  (globalThis as Record<string, unknown>).__traceId = traceId;
  const lockAcquired = await acquireDispatchLock(orderId);
  if (!lockAcquired) {
    return fail("该订单正在被其他操作处理，请稍后重试", { status: 409, traceId });
  }

  try {
    const result = await prisma.$transaction<ReassignTransactionResult>(
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

        if (!ALLOWED_REASSIGN_STATUSES.has(order.status)) {
          return {
            success: false,
            message: `订单状态不允许改派（当前状态: ${order.status}，仅 ASSIGNED 或 ACCEPTED 可改派）`,
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
            message: `当前派单已非活跃状态（派单状态: ${order.currentAssignment.status}），无法改派`,
            status: 409,
            currentStatus: order.status
          };
        }

        if (order.currentAssignment.driverId === driverId) {
          return {
            success: false,
            message: "新司机不能与当前司机相同",
            status: 400
          };
        }

        const nextDriver = await tx.driver.findUnique({
          where: { id: driverId },
          select: { id: true, name: true, status: true, isActive: true }
        });

        if (!nextDriver || !nextDriver.isActive) {
          return { success: false, message: "新司机不存在或已停用", status: 404 };
        }

        if (nextDriver.status === "OFFLINE" || nextDriver.status === "UNAVAILABLE") {
          return {
            success: false,
            message: "新司机当前不参与调度",
            status: 400
          };
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

        return { success: true, data: { order: updatedOrder, assignment: nextAssignment } };
      },
      { timeout: 15000 }
    );

    if (!result.success) {
      workflowLog.warn("assignment_failed", {
        traceId,
        action: "REASSIGN",
        orderId,
        driverId,
        reason: result.message,
        currentStatus: result.currentStatus,
        operator: currentUser.email,
        elapsedMs: Date.now() - startTime
      });
      return fail(result.message, { status: result.status, traceId });
    }

    workflowLog.info("assignment_succeeded", {
      traceId,
      action: "REASSIGN",
      orderId,
      driverId,
      operator: currentUser.email,
      elapsedMs: Date.now() - startTime
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "改派失败";
    workflowLog.error("assignment_error", {
      traceId,
      action: "REASSIGN",
      orderId,
      driverId,
      operator: currentUser.email,
      error: message,
      elapsedMs: Date.now() - startTime
    });
    return fail(message, { status: 500, traceId });
  } finally {
    await releaseDispatchLock(orderId);
  }
}

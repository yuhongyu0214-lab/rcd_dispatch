import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireDispatchLock, releaseDispatchLock } from "@/lib/redis";

type AssignRequestBody = {
  orderId?: string;
  driverId?: string;
};

type AssignTransactionResult =
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

const ALLOWED_ASSIGN_STATUSES = new Set(["PENDING", "RECYCLED"]);
const workflowLog = createLogger("admin-workflow");

export async function POST(request: Request) {
  const startTime = Date.now();
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
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

  // Redis 分布式锁：防止并发重复派单
  (globalThis as Record<string, unknown>).__traceId = traceId;
  const lockAcquired = await acquireDispatchLock(orderId);
  if (!lockAcquired) {
    return fail("该订单正在被其他操作处理，请稍后重试", { status: 409, traceId });
  }

  try {
    const result = await prisma.$transaction<AssignTransactionResult>(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            orderNo: true,
            status: true
          }
        });

        if (!order) {
          return { success: false, message: "订单不存在", status: 404 };
        }

        if (!ALLOWED_ASSIGN_STATUSES.has(order.status)) {
          return {
            success: false,
            message: `订单状态不允许派单（当前状态: ${order.status}，仅 PENDING 或 RECYCLED 可派单）`,
            status: 409,
            currentStatus: order.status
          };
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
          return { success: false, message: "司机不存在或已停用", status: 404 };
        }

        if (driver.status === "OFFLINE" || driver.status === "UNAVAILABLE") {
          return {
            success: false,
            message: "该司机当前不参与调度",
            status: 400
          };
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

        return { success: true, data: { order: updatedOrder, assignment } };
      },
      { timeout: 15000 }
    );

    if (!result.success) {
      workflowLog.warn("assignment_failed", {
        traceId,
        action: "ASSIGN",
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
      action: "ASSIGN",
      orderId,
      driverId,
      operator: currentUser.email,
      elapsedMs: Date.now() - startTime
    });
    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "派单失败";
    workflowLog.error("assignment_error", {
      traceId,
      action: "ASSIGN",
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

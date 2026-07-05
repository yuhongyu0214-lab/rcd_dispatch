import { fail, ok } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { extractDriverId, resolveSystemOperatorUserId } from "../../../_utils";

export const dynamic = "force-dynamic";

// ============================================================================
// 类型定义
// ============================================================================

type AcceptResult =
  | {
      success: true;
      data: {
        assignment: { id: string; status: string };
        order: { id: string; status: string; orderNo: string };
      };
    }
  | {
      success: false;
      message: string;
      status: number;
    };

const driverLog = createLogger("driver-workflow");

// ============================================================================
// POST /api/driver/tasks/[id]/accept — 司机接单
// ============================================================================

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const startTime = Date.now();

  const orderId = context.params.id.trim();

  if (!orderId) {
    return fail("请提供订单 ID", { status: 400, traceId });
  }

  // ---- 1. 鉴权 ----
  let driverId = await extractDriverId(request);

  // 兼容旧版：从请求体获取 driverId
  if (!driverId) {
    try {
      const body = (await request.clone().json()) as { driverId?: string };
      driverId = body.driverId?.trim() ?? null;
    } catch {
      // 忽略
    }
  }

  if (!driverId) {
    // 重新读取 body（clone 已消耗，需重新 parse）
    try {
      const body = (await request.json()) as { driverId?: string };
      driverId = body.driverId?.trim() ?? null;
    } catch {
      return fail("请提供司机 ID", { status: 401, traceId });
    }
  }

  if (!driverId) {
    return fail("请提供司机 ID", { status: 401, traceId });
  }

  // ---- 2. 事务执行 ----
  try {
    const result = await prisma.$transaction<AcceptResult>(
      async (tx) => {
        // 2a. 获取系统操作员
        const operatorUserId = await resolveSystemOperatorUserId(tx);
        if (!operatorUserId) {
          return { success: false, message: "缺少系统操作员账号", status: 500 };
        }

        // 2b. 查找订单及其当前派单
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

        if (!order.currentAssignment) {
          return {
            success: false,
            message: "该订单尚未派单",
            status: 400
          };
        }

        // 2c. 校验任务属于该司机
        if (order.currentAssignment.driverId !== driverId) {
          return {
            success: false,
            message: "该任务不属于当前司机",
            status: 403
          };
        }

        // 2d. 校验任务状态为 ACTIVE（防止重复接单）
        if (order.currentAssignment.status !== "ACTIVE") {
          return {
            success: false,
            message:
              order.currentAssignment.status === "ACCEPTED"
                ? "该任务已被接单"
                : "该任务状态不允许接单",
            status: 409
          };
        }

        // 2e. 乐观锁更新 Assignment（仅当 status=ACTIVE 时成功）
        const assignmentUpdate = await tx.assignment.updateMany({
          where: {
            id: order.currentAssignment.id,
            status: "ACTIVE"
          },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date()
          }
        });

        if (assignmentUpdate.count === 0) {
          return {
            success: false,
            message: "任务已被接单或状态已变更，请刷新后重试",
            status: 409
          };
        }

        // 2f. 更新 Assignment 实体引用（获取更新后的数据）
        const updatedAssignment = await tx.assignment.findUniqueOrThrow({
          where: { id: order.currentAssignment.id },
          select: { id: true, status: true }
        });

        // 2g. 更新 Order 状态
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "ACCEPTED" },
          select: { id: true, status: true, orderNo: true }
        });

        // 2h. 更新司机状态（执行任务中）
        await tx.driver.update({
          where: { id: driverId },
          data: { status: "S4" }
        });

        // 2i. 写操作日志
        await tx.operationLog.create({
          data: {
            entityType: "ORDER",
            entityId: order.id,
            action: "ACCEPT",
            operatorUserId,
            metadataJson: {
              traceId,
              actor: "DRIVER_API",
              orderId: order.id,
              orderNo: order.orderNo,
              assignmentId: order.currentAssignment.id,
              driverId,
              driverName: order.currentAssignment.driver.name,
              fromAssignmentStatus: "ACTIVE",
              toAssignmentStatus: updatedAssignment.status,
              fromOrderStatus: order.status,
              toOrderStatus: updatedOrder.status
            }
          }
        });

        return {
          success: true,
          data: {
            assignment: updatedAssignment,
            order: updatedOrder
          }
        };
      },
      { timeout: 15_000 }
    );

    // ---- 3. 处理结果 ----
    if (!result.success) {
      const elapsed = Date.now() - startTime;
      driverLog.warn("driver_accept_failed", {
        traceId,
        action: "ACCEPT",
        orderId,
        driverId,
        reason: result.message,
        statusCode: result.status,
        elapsed
      });
      return fail(result.message, { status: result.status, traceId });
    }

    const elapsed = Date.now() - startTime;
    driverLog.info("driver_accept_succeeded", {
      traceId,
      action: "ACCEPT",
      orderId,
      driverId,
      assignmentId: result.data.assignment.id,
      elapsed
    });

    return ok(result.data, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "司机接单失败";
    driverLog.error("driver_accept_error", {
      traceId,
      action: "ACCEPT",
      orderId,
      driverId,
      error: message
    });
    return fail(message, { status: 500, traceId });
  }
}

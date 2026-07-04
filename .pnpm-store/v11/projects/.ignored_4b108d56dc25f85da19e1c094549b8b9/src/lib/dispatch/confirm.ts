import { prisma } from "@/lib/prisma";
import { acquireDispatchLock, releaseDispatchLock } from "@/lib/redis";

import { dispatchLog } from "./log";

export type ConfirmDispatchResult =
  | {
      success: true;
      data: {
        order: Awaited<ReturnType<typeof prisma.order.update>>;
        assignment: Awaited<ReturnType<typeof prisma.assignment.create>>;
      };
    }
  | {
      success: false;
      error: string;
      status: number;
    };

/**
 * Confirm a dispatch recommendation and assign the driver to the order.
 *
 * Concurrency protection (two layers):
 * 1. Redis dispatch lock (SET NX EX 10s) — prevents concurrent confirm on same order
 * 2. Prisma optimistic lock (updateMany WHERE status) — DB-level safety net
 *
 * Flow:
 * 1. Validate order + driver
 * 2. Acquire Redis lock (10s TTL, auto-release on failure)
 * 3. Execute Prisma transaction (create Assignment + update Order + write OperationLog)
 * 4. Release Redis lock (Lua script safe release)
 *
 * Returns 409 on lock conflict or optimistic lock failure.
 */
export async function confirmRecommendedDispatch(input: {
  orderId: string;
  driverId: string;
  operatorUserId: string;
  traceId: string;
}): Promise<ConfirmDispatchResult> {
  dispatchLog.info("dispatch_confirm_started", {
    traceId: input.traceId,
    orderId: input.orderId,
    driverId: input.driverId
  });

  // 1. Validate order
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      currentAssignmentId: true,
      currentAssignment: {
        select: {
          id: true,
          status: true
        }
      }
    }
  });

  if (!order) {
    dispatchLog.warn("dispatch_confirm_order_not_found", {
      traceId: input.traceId,
      orderId: input.orderId
    });
    return { success: false, error: "订单不存在", status: 404 };
  }

  if (order.status !== "PENDING" && order.status !== "RECOMMENDING") {
    dispatchLog.warn("dispatch_confirm_invalid_status", {
      traceId: input.traceId,
      orderId: input.orderId,
      status: order.status
    });
    return {
      success: false,
      error: "只有待分配或推荐中订单可以确认推荐派单",
      status: 400
    };
  }

  if (
    order.currentAssignment &&
    (order.currentAssignment.status === "ACTIVE" || order.currentAssignment.status === "ACCEPTED")
  ) {
    dispatchLog.warn("dispatch_confirm_duplicate_assignment", {
      traceId: input.traceId,
      orderId: input.orderId
    });
    return {
      success: false,
      error: "订单已有有效派单，请使用改派",
      status: 409
    };
  }

  // 2. Validate driver
  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    select: {
      id: true,
      name: true,
      status: true,
      isActive: true
    }
  });

  if (!driver || !driver.isActive) {
    dispatchLog.warn("dispatch_confirm_driver_not_found", {
      traceId: input.traceId,
      driverId: input.driverId
    });
    return { success: false, error: "司机不存在或已停用", status: 404 };
  }

  if (driver.status === "OFFLINE" || driver.status === "UNAVAILABLE") {
    dispatchLog.warn("dispatch_confirm_driver_unavailable", {
      traceId: input.traceId,
      driverId: input.driverId,
      status: driver.status
    });
    return { success: false, error: "该司机当前不参与调度", status: 400 };
  }

  // 3. Acquire Redis dispatch lock (10s TTL)
  //    When Redis is degraded, acquireDispatchLock returns true (fallback to DB optimistic lock)
  const lockAcquired = await acquireDispatchLock(input.orderId, 10);

  if (!lockAcquired) {
    dispatchLog.warn("dispatch_confirm_lock_conflict", {
      traceId: input.traceId,
      orderId: input.orderId
    });
    return {
      success: false,
      error: "订单正在被其他调度员操作，请稍后重试",
      status: 409
    };
  }

  try {
    // 4. Execute Prisma transaction (optimistic lock via updateMany WHERE status)
    const data = await prisma.$transaction(async (tx) => {
      // Optimistic lock: only update if status is still PENDING/RECOMMENDING
      const lockedOrder = await tx.order.updateMany({
        where: {
          id: input.orderId,
          status: { in: ["PENDING", "RECOMMENDING"] },
          currentAssignmentId: order.currentAssignmentId
        },
        data: {
          status: "ASSIGNED",
          driverNameSnapshot: driver.name
        }
      });

      if (lockedOrder.count !== 1) {
        return null;
      }

      const assignment = await tx.assignment.create({
        data: {
          orderId: order.id,
          driverId: driver.id,
          type: "RECOMMEND_ASSIGN",
          status: "ACTIVE",
          createdByUserId: input.operatorUserId
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          currentAssignmentId: assignment.id
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
          operatorUserId: input.operatorUserId,
          metadataJson: {
            traceId: input.traceId,
            orderNo: order.orderNo,
            driverId: driver.id,
            driverName: driver.name,
            assignmentType: "RECOMMEND_ASSIGN",
            fromStatus: order.status,
            toStatus: updatedOrder.status
          }
        }
      });

      return { order: updatedOrder, assignment };
    }, { timeout: 15000 });

    if (!data) {
      dispatchLog.warn("dispatch_confirm_optimistic_lock_failed", {
        traceId: input.traceId,
        orderId: input.orderId
      });
      return {
        success: false,
        error: "订单状态已变化，请刷新后重试",
        status: 409
      };
    }

    dispatchLog.info("dispatch_confirm_succeeded", {
      traceId: input.traceId,
      orderId: input.orderId,
      driverId: input.driverId,
      assignmentId: data.assignment.id
    });

    return { success: true, data };
  } catch (err) {
    dispatchLog.error("dispatch_confirm_transaction_error", {
      traceId: input.traceId,
      orderId: input.orderId,
      driverId: input.driverId,
      error: String(err)
    });
    return {
      success: false,
      error: "派单确认失败，请重试",
      status: 500
    };
  } finally {
    // 5. Release Redis lock (safe release via Lua script)
    await releaseDispatchLock(input.orderId);
  }
}

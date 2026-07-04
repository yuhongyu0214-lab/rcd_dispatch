import { prisma } from "@/lib/prisma";

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

export async function confirmRecommendedDispatch(input: {
  orderId: string;
  driverId: string;
  operatorUserId: string;
  traceId: string;
}): Promise<ConfirmDispatchResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      status: true
    }
  });

  if (!order) {
    return { success: false, error: "订单不存在", status: 404 };
  }

  if (order.status !== "PENDING" && order.status !== "RECOMMENDING") {
    return {
      success: false,
      error: "只有待分配或推荐中订单可以确认推荐派单",
      status: 400
    };
  }

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
    return { success: false, error: "司机不存在或已停用", status: 404 };
  }

  if (driver.status === "OFFLINE" || driver.status === "UNAVAILABLE") {
    return { success: false, error: "该司机当前不参与调度", status: 400 };
  }

  const data = await prisma.$transaction(async (tx) => {
    const lockedOrder = await tx.order.updateMany({
      where: {
        id: input.orderId,
        status: { in: ["PENDING", "RECOMMENDING"] },
        currentAssignmentId: null
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
    return {
      success: false,
      error: "订单状态已变化，请刷新后重试",
      status: 409
    };
  }

  return { success: true, data };
}

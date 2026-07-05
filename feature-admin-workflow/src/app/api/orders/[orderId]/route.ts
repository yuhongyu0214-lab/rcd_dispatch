import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createLogger } from "@/lib/logger";
import { toOrderDisplayDTO } from "@/lib/map/order-display-dto";
import { prisma } from "@/lib/prisma";

const log = createLogger("orders-detail-api");

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  const traceId = _request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        store: { select: { id: true, code: true, name: true } },
        vehicle: { select: { id: true, licensePlate: true, vehicleType: true } },
        currentAssignment: {
          include: {
            driver: { select: { id: true, name: true, phone: true, status: true } }
          }
        },
        assignments: {
          orderBy: { assignedAt: "desc" },
          include: {
            driver: { select: { id: true, name: true, phone: true, status: true } }
          }
        }
      }
    });

    if (!order) {
      return fail("订单不存在", { status: 404, traceId });
    }

    // ---- 权限校验 ----
    // 管理员/调度员可查看所有订单；司机只能查看自己被分配的订单
    const isAdmin = isAdminRole(currentUser.role);
    const isAssignedDriver =
      currentUser.driverId != null &&
      order.currentAssignment?.driverId === currentUser.driverId;

    if (!isAdmin && !isAssignedDriver) {
      return fail("当前账号无权限查看订单详情", { status: 403, traceId });
    }

    // ---- 操作日志 ----
    const logs = await prisma.operationLog.findMany({
      where: {
        entityType: "ORDER",
        entityId: order.id
      },
      orderBy: { createdAt: "desc" },
      include: {
        operatorUser: { select: { id: true, name: true, email: true } }
      },
      take: 50
    });

    log.info("order_detail_succeeded", {
      traceId,
      orderId: order.id,
      userId: currentUser.id,
      role: isAdmin ? "admin" : "driver"
    });

    return ok(
      {
        order: {
          ...toOrderDisplayDTO(order),
          // 额外字段：H5 导航需要经纬度
          pickupLat: order.pickupLat,
          pickupLng: order.pickupLng,
          returnLat: order.returnLat,
          returnLng: order.returnLng,
          assignments: order.assignments
        },
        logs
      },
      { traceId }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "订单详情加载失败";
    log.error("order_detail_error", { traceId, orderId: params.orderId, error: message });
    return fail(message, { status: 500, traceId });
  }
}

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  const traceId = getTraceId(_request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限查看订单详情", { status: 403, traceId });
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

    return ok({ order, logs }, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "订单详情加载失败";
    return fail(message, { status: 500, traceId });
  }
}

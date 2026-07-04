import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES } from "@/types";

const VALID_STATUSES = new Set<string>(ORDER_STATUSES);

function parsePositiveInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限查看订单", { status: 403, traceId });
  }

  try {
    const url = new URL(request.url);
    const keyword = url.searchParams.get("q")?.trim();
    const status = url.searchParams.get("status")?.trim();
    const page = parsePositiveInteger(url.searchParams.get("page"), 1, 9999);
    const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), 20, 100);

    const where: Prisma.OrderWhereInput = {};

    if (status && status !== "ALL") {
      if (!VALID_STATUSES.has(status)) {
        return fail("订单状态筛选值不合法", { status: 400, traceId });
      }

      where.status = status as Prisma.EnumOrderStatusFilter["equals"];
    }

    if (keyword) {
      where.OR = [
        { orderNo: { contains: keyword, mode: "insensitive" } },
        { licensePlateSnapshot: { contains: keyword, mode: "insensitive" } },
        { pickupAddress: { contains: keyword, mode: "insensitive" } },
        { returnAddress: { contains: keyword, mode: "insensitive" } },
        { store: { name: { contains: keyword, mode: "insensitive" } } }
      ];
    }

    const [total, orders, drivers] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          store: { select: { id: true, name: true, code: true } },
          vehicle: { select: { id: true, licensePlate: true, vehicleType: true } },
          currentAssignment: {
            include: {
              driver: { select: { id: true, name: true, phone: true, status: true } }
            }
          }
        }
      }),
      prisma.driver.findMany({
        where: {
          isActive: true
        },
        orderBy: [{ storeId: "asc" }, { name: "asc" }],
        include: {
          store: { select: { id: true, name: true } }
        }
      })
    ]);

    return ok(
      {
        items: orders,
        total,
        page,
        pageSize,
        drivers
      },
      { traceId }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "订单列表加载失败";
    return fail(message, { status: 500, traceId });
  }
}

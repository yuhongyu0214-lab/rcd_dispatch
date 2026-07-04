import type { OrderStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createLogger } from "@/lib/logger";
import { toOrderDisplayDTO } from "@/lib/map/order-display-dto";
import { prisma } from "@/lib/prisma";

const ORDER_STATUSES = new Set([
  "PENDING",
  "RECOMMENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "RECYCLED",
  "CANCELLED"
]);

function parsePositiveInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function parsePageSize(value: string | null) {
  const parsed = Number(value);
  return parsed === 50 || parsed === 100 ? parsed : 20;
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

const log = createLogger("orders-api");

export async function GET(request: Request) {
  const startTime = Date.now();
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("当前账号无权限查看订单", { status: 403, traceId });
  }

  try {
    const url = new URL(request.url);
    const keyword = url.searchParams.get("q")?.trim();
    const statusRaw = url.searchParams.get("status")?.trim();
    const storeId = url.searchParams.get("storeId")?.trim();
    const scheduledStart = url.searchParams.get("scheduledStart")?.trim();
    const scheduledEnd = url.searchParams.get("scheduledEnd")?.trim();
    const includeCompleted = url.searchParams.get("includeCompleted") === "true";
    const page = parsePositiveInteger(url.searchParams.get("page"), 1, 9999);
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));

    const where: Prisma.OrderWhereInput = {};

    // 多状态筛选：逗号分隔
    if (statusRaw && statusRaw !== "ALL") {
      const statuses = statusRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const validStatuses = statuses.filter((s) => ORDER_STATUSES.has(s));

      if (validStatuses.length === 0) {
        return fail("订单状态筛选值不合法", { status: 400, traceId });
      }

      if (validStatuses.length === 1) {
        where.status = validStatuses[0] as OrderStatus;
      } else {
        where.status = { in: validStatuses as OrderStatus[] };
      }
    } else if (!includeCompleted) {
      where.status = { not: "COMPLETED" };
    }

    // 门店筛选
    if (storeId) {
      where.storeId = storeId;
    }

    // 时间范围筛选
    if (scheduledStart || scheduledEnd) {
      const scheduledAtFilter: Prisma.DateTimeFilter = {};
      const startDate = parseDateParam(scheduledStart ?? null);
      const endDate = parseDateParam(scheduledEnd ?? null);

      if (startDate) scheduledAtFilter.gte = startDate;
      if (endDate) scheduledAtFilter.lte = endDate;

      if (startDate || endDate) {
        where.scheduledAt = scheduledAtFilter;
      }
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
            select: {
              id: true,
              status: true,
              type: true,
              driverId: true,
              assignedAt: true,
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

    log.info("orders_list_succeeded", {
      traceId,
      total,
      page,
      pageSize,
      status: statusRaw ?? "ALL",
      storeId: storeId ?? "ALL",
      elapsedMs: Date.now() - startTime
    });

    return ok(
      {
        items: orders.map(toOrderDisplayDTO),
        total,
        page,
        pageSize,
        drivers
      },
      { traceId }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "订单列表加载失败";
    log.error("orders_list_error", { traceId, error: message, elapsedMs: Date.now() - startTime });
    return fail(message, { status: 500, traceId });
  }
}

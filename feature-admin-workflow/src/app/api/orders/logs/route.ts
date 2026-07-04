import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 60;
  }

  return Math.min(parsed, 100);
}

function parseSkip(value: string | null) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("当前账号无权限查看操作日志", { status: 403, traceId });
  }

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId")?.trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const skip = parseSkip(url.searchParams.get("skip"));
    const action = url.searchParams.get("action")?.trim();

    const where: Prisma.OperationLogWhereInput = {
      entityType: "ORDER"
    };

    if (orderId) {
      where.entityId = orderId;
    }

    if (action) {
      where.action = action as Prisma.EnumOperationActionFilter["equals"];
    }

    const [total, items] = await prisma.$transaction([
      prisma.operationLog.count({ where }),
      prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          operatorUser: { select: { id: true, name: true, email: true } }
        },
        take: limit,
        skip
      })
    ]);

    return ok({ items, total }, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作日志加载失败";
    return fail(message, { status: 500, traceId });
  }
}

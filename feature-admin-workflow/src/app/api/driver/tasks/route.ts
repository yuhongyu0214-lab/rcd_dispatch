import type { OrderStatus } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { extractDriverId, toDriverTaskDTO } from "../_utils";

export const dynamic = "force-dynamic";

const driverLog = createLogger("driver-workflow");

/** 司机可见的订单状态（含已分配和进行中） */
const DRIVER_ORDER_STATUSES: readonly OrderStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS"
] as const;

/** 司机可见的派单状态 */
const DRIVER_ASSIGNMENT_STATUSES = ["ACTIVE", "ACCEPTED"] as const;

// ============================================================================
// GET /api/driver/tasks — 司机工单列表
// ============================================================================

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // ---- 1. 鉴权 ----
    const driverId = extractDriverId(request);

    if (!driverId) {
      // 兼容旧版：从 query params 直接获取
      const url = new URL(request.url);
      const queryDriverId = url.searchParams.get("driverId")?.trim();
      if (!queryDriverId) {
        return fail("请提供司机 ID（Authorization header 或 query 参数）", {
          status: 401,
          traceId
        });
      }
      // eslint-disable-next-line
      const _unused = driverId; // 标记使用 query 方式
    }

    const url = new URL(request.url);
    const effectiveDriverId =
      extractDriverId(request) ?? url.searchParams.get("driverId")?.trim();

    if (!effectiveDriverId) {
      return fail("请提供司机 ID", { status: 401, traceId });
    }

    // ---- 2. 可选筛选参数 ----
    const statusFilter = url.searchParams.get("status")?.trim();

    // ---- 3. 校验司机存在性 ----
    const driver = await prisma.driver.findUnique({
      where: { id: effectiveDriverId },
      include: {
        store: { select: { id: true, code: true, name: true } }
      }
    });

    if (!driver || !driver.isActive) {
      return fail("司机不存在或已停用", { status: 404, traceId });
    }

    // ---- 4. 构建查询条件 ----
    const orderStatusFilter: OrderStatus[] = statusFilter
      ? [statusFilter as OrderStatus]
      : [...DRIVER_ORDER_STATUSES];

    const orders = await prisma.order.findMany({
      where: {
        status: { in: orderStatusFilter },
        currentAssignment: {
          driverId: effectiveDriverId,
          status: { in: [...DRIVER_ASSIGNMENT_STATUSES] }
        }
      },
      orderBy: {
        currentAssignment: {
          assignedAt: "desc"
        }
      },
      include: {
        store: { select: { id: true, name: true, code: true } },
        vehicle: { select: { id: true, licensePlate: true, vehicleType: true } },
        currentAssignment: {
          include: {
            driver: { select: { id: true, name: true, phone: true, status: true } }
          }
        }
      }
    });

    // ---- 5. 转换为 DTO ----
    const tasks = orders.map(toDriverTaskDTO);

    const elapsed = Date.now() - startTime;

    driverLog.info("driver_tasks_listed", {
      traceId,
      driverId: effectiveDriverId,
      taskCount: tasks.length,
      statusFilter: statusFilter ?? "all",
      elapsed
    });

    return ok(
      {
        driver: {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          status: driver.status,
          store: driver.store
        },
        tasks
      },
      { traceId }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "司机任务读取失败";
    driverLog.error("driver_tasks_error", {
      traceId,
      error: message
    });
    return fail(message, { status: 500, traceId });
  }
}

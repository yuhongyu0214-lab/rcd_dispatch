import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

import { TaskListPoller } from "../components/task-list-poller";
import { TABS } from "../task-tabs";

// ============================================================================
// 类型定义
// ============================================================================

type DriverTaskDTO = {
  taskId: string;
  orderNo: string;
  type: string;
  status: string;
  assignmentId: string;
  assignmentStatus: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  assignedAt: string;
  store: {
    id: string;
    code: string;
    name: string;
  };
  vehicle: {
    id: string | null;
    licensePlate: string | null;
    vehicleType: string | null;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    status: string;
  };
};

// ============================================================================
// Page
// ============================================================================

export default async function DriverTasksPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const user = await getCurrentUser();

  if (!user?.driverId) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        暂无司机身份，请联系管理员绑定。
      </div>
    );
  }

  // 服务端直接查询数据库
  let tasks: DriverTaskDTO[] = [];
  let fetchError: string | null = null;

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: user.driverId },
      include: { store: { select: { id: true, code: true, name: true } } },
    });

    if (!driver || !driver.isActive) {
      fetchError = "司机不存在或已停用";
    } else {
      const orders = await prisma.order.findMany({
        where: {
          status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
          currentAssignment: {
            driverId: user.driverId,
            status: { in: ["ACTIVE", "ACCEPTED"] },
          },
        },
        orderBy: { currentAssignment: { assignedAt: "desc" } },
        include: {
          store: { select: { id: true, name: true, code: true } },
          vehicle: {
            select: { id: true, licensePlate: true, vehicleType: true },
          },
          currentAssignment: {
            include: {
              driver: {
                select: { id: true, name: true, phone: true, status: true },
              },
            },
          },
        },
      });

      tasks = orders.map((order) => ({
        taskId: order.id,
        orderNo: order.orderNo,
        type: order.type,
        status: order.status,
        assignmentId: order.currentAssignment!.id,
        assignmentStatus: order.currentAssignment!.status,
        pickupAddress: order.pickupAddress,
        returnAddress: order.returnAddress,
        scheduledAt: order.scheduledAt.toISOString(),
        assignedAt: order.currentAssignment!.assignedAt.toISOString(),
        store: order.store,
        vehicle: order.vehicle
          ? {
              id: order.vehicle.id,
              licensePlate: order.vehicle.licensePlate,
              vehicleType: order.vehicle.vehicleType,
            }
          : { id: null, licensePlate: null, vehicleType: null },
        driver: {
          id: order.currentAssignment!.driver.id,
          name: order.currentAssignment!.driver.name,
          phone: order.currentAssignment!.driver.phone,
          status: order.currentAssignment!.driver.status,
        },
      }));
    }
  } catch {
    fetchError = "服务暂时不可用";
  }

  const activeTab = searchParams.tab ?? "all";

  return (
    <div className="flex flex-col gap-4 pb-16">
      {/* 错误提示 */}
      {fetchError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {fetchError}
        </div>
      ) : null}

      {/* 客户端 Tab + 轮询 + 空状态 */}
      <TaskListPoller
        initialTasks={tasks}
        driverId={user.driverId!}
        initialTab={activeTab}
        hasFetchError={fetchError !== null}
      />
    </div>
  );
}

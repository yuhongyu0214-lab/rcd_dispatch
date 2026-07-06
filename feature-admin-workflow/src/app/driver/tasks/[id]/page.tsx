import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

import { CopyButton } from "../../components/copy-button";
import { TaskActions } from "../../components/task-actions";

// ============================================================================
// 类型定义
// ============================================================================

type DetailResponse = {
  success: true;
  data: {
    order: {
      id: string;
      orderNo: string;
      type: string;
      status: string;
      pickupAddress: string;
      pickupLat: number | null;
      pickupLng: number | null;
      returnAddress: string;
      returnLat: number | null;
      returnLng: number | null;
      scheduledAt: string;
      storeName: string;
      plate: string;
      vehicle: {
        id: string;
        licensePlate: string;
        vehicleType: string;
      } | null;
    };
    logs: Array<{
      id: string;
      action: string;
      reason: string | null;
      createdAt: string;
      operatorUser: {
        id: string;
        name: string;
      };
      metadataJson: Record<string, unknown> | null;
    }>;
  };
};

// ============================================================================
// 标签映射
// ============================================================================

const TYPE_LABEL: Record<string, { text: string; color: string }> = {
  STORE_PICKUP:  { text: "门店取车", color: "bg-blue-100 text-blue-700" },
  STORE_RETURN:  { text: "门店还车", color: "bg-green-100 text-green-700" },
  DOOR_DELIVERY: { text: "送车上门", color: "bg-blue-100 text-blue-700" },
  DOOR_PICKUP:   { text: "上门取车", color: "bg-green-100 text-green-700" }
};

const ACTION_LABEL: Record<string, string> = {
  ASSIGN:  "派单",
  REASSIGN:"改派",
  WITHDRAW:"撤回",
  ACCEPT:  "接单",
  COMPLETE:"完单"
};

// ============================================================================
// Page
// ============================================================================

export default async function DriverTaskDetailPage({
  params
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();

  if (!user?.driverId) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        暂无司机身份，请联系管理员绑定。
      </div>
    );
  }

  const orderId = params.id;

  let order: DetailResponse["data"]["order"] | null = null;
  let logs: DetailResponse["data"]["logs"] = [];
  let fetchError: string | null = null;

  try {
    const dbOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { name: true } },
        vehicle: { select: { id: true, licensePlate: true, vehicleType: true } }
      }
    });

    if (!dbOrder) {
      fetchError = "订单不存在";
    } else {
      order = {
        id: dbOrder.id,
        orderNo: dbOrder.orderNo,
        type: dbOrder.type,
        status: dbOrder.status,
        pickupAddress: dbOrder.pickupAddress,
        pickupLat: dbOrder.pickupLat,
        pickupLng: dbOrder.pickupLng,
        returnAddress: dbOrder.returnAddress,
        returnLat: dbOrder.returnLat,
        returnLng: dbOrder.returnLng,
        scheduledAt: dbOrder.scheduledAt.toISOString(),
        storeName: dbOrder.store.name,
        plate: dbOrder.licensePlateSnapshot ?? dbOrder.vehicle?.licensePlate ?? "未绑定车牌",
        vehicle: dbOrder.vehicle
          ? { id: dbOrder.vehicle.id, licensePlate: dbOrder.vehicle.licensePlate, vehicleType: dbOrder.vehicle.vehicleType }
          : null
      };

      const dbLogs = await prisma.operationLog.findMany({
        where: { entityType: "ORDER", entityId: orderId },
        orderBy: { createdAt: "desc" },
        include: { operatorUser: { select: { id: true, name: true } } },
        take: 50
      });

      logs = dbLogs.map((log) => ({
        id: log.id,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt.toISOString(),
        operatorUser: { id: log.operatorUser.id, name: log.operatorUser.name },
        metadataJson: log.metadataJson as Record<string, unknown> | null
      }));
    }
  } catch {
    fetchError = "服务暂时不可用";
  }

  if (fetchError || !order) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        {fetchError ?? "订单不存在"}
      </div>
    );
  }

  const typeInfo = TYPE_LABEL[order.type] ?? { text: order.type, color: "bg-slate-100 text-slate-600" };

  return (
    <div className="flex flex-col gap-4 pb-20">
      {/* 返回 */}
      <Link
        href="/driver/tasks"
        className="flex items-center gap-1 text-sm text-slate-600"
      >
        ← 返回工单列表
      </Link>

      {/* 订单号 + 复制 */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {order.orderNo}
        </h2>
        <CopyButton text={order.orderNo} />
      </div>

      {/* 取还方式标签 */}
      <span className={`inline-block w-fit rounded-lg px-2.5 py-1 text-sm font-medium ${typeInfo.color}`}>
        {typeInfo.text}
      </span>

      {/* 订单信息卡片 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-3">
          {/* 取车 */}
          <div>
            <p className="text-xs font-medium text-slate-500">取车地址</p>
            <p className="mt-0.5 text-sm text-slate-900">{order.pickupAddress}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              🕐 取车时间：
              {new Date(order.scheduledAt).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-slate-100" />

          {/* 还车 */}
          <div>
            <p className="text-xs font-medium text-slate-500">还车地址</p>
            <p className="mt-0.5 text-sm text-slate-900">{order.returnAddress}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              🕐 还车时间：
              {new Date(order.scheduledAt).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-slate-100" />

          {/* 车辆 + 门店 */}
          <div className="flex gap-6 text-xs text-slate-500">
            <span>
              🚗 {order.plate ?? "-"} · {order.vehicle?.vehicleType ?? "-"}
            </span>
            <span>🏪 {order.storeName}</span>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <TaskActions
        orderId={order.id}
        orderStatus={order.status}
        driverId={user.driverId!}
        pickupLat={order.pickupLat}
        pickupLng={order.pickupLng}
        returnLat={order.returnLat}
        returnLng={order.returnLng}
      />

      {/* 操作记录 */}
      {logs.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-700">
            操作记录
          </h3>
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-900">
                    {ACTION_LABEL[log.action] ?? log.action}
                  </span>
                  <span className="text-slate-400">
                    {log.operatorUser.name}
                  </span>
                </div>
                <span className="text-slate-400">
                  {new Date(log.createdAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

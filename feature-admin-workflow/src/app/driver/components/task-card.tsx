import Link from "next/link";
import { AcceptButton } from "./accept-button";

// ============================================================================
// 类型
// ============================================================================

type TaskCardInput = {
  taskId: string;
  orderNo: string;
  type: string;
  status: string;
  assignmentId: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  vehicle: {
    id: string | null;
    licensePlate: string | null;
    vehicleType: string | null;
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

const STATUS_LABEL: Record<string, string> = {
  PENDING:    "待处理",
  ASSIGNED:   "待接单",
  ACCEPTED:   "已接单",
  IN_PROGRESS:"进行中",
  COMPLETED:  "已完成"
};

// ============================================================================
// TaskCard
// ============================================================================

export function TaskCard({
  task,
  driverId
}: {
  task: TaskCardInput;
  driverId: string;
}) {
  const typeInfo = TYPE_LABEL[task.type] ?? { text: task.type, color: "bg-slate-100 text-slate-600" };
  const showAccept = task.status === "ASSIGNED";

  return (
    <Link
      href={`/driver/tasks/${task.taskId}`}
      className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.98]"
    >
      {/* 第一行：类型标签 + 车辆信息 */}
      <div className="flex items-center justify-between">
        <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-medium ${typeInfo.color}`}>
          {typeInfo.text}
        </span>
        <span className="text-xs text-slate-500">
          {task.vehicle.licensePlate ?? "-"} · {task.vehicle.vehicleType ?? "-"}
        </span>
      </div>

      {/* 第二行：取还车地址 */}
      <div className="mt-3 space-y-0.5">
        <p className="flex items-start gap-1 text-sm text-slate-700">
          <span className="mt-0.5 shrink-0 text-xs">📍取</span>
          <span className="line-clamp-1">{task.pickupAddress}</span>
        </p>
        <p className="flex items-start gap-1 text-sm text-slate-700">
          <span className="mt-0.5 shrink-0 text-xs">📍还</span>
          <span className="line-clamp-1">{task.returnAddress}</span>
        </p>
      </div>

      {/* 第三行：时间 */}
      <p className="mt-2 text-xs text-slate-500">
        🕐 {new Date(task.scheduledAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })}
      </p>

      {/* 第四行：操作区 */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        {showAccept ? (
          <AcceptButton
            orderId={task.taskId}
            driverId={driverId}
          />
        ) : null}
      </div>
    </Link>
  );
}

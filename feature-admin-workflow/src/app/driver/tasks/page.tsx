import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth/current-user";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/auth/session";

import { TaskCard } from "../components/task-card";

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

type TasksResponse = {
  success: true;
  data: {
    driver: {
      id: string;
      name: string;
      phone: string;
      status: string;
      store: { id: string; name: string; code: string };
    };
    tasks: DriverTaskDTO[];
  };
};

// ============================================================================
// Tab 定义
// ============================================================================

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "active", label: "进行中" },
  { key: "completed", label: "已完成" }
] as const;

function filterTasks(
  tasks: DriverTaskDTO[],
  tab: string | undefined
): DriverTaskDTO[] {
  switch (tab) {
    case "pending":
      return tasks.filter(
        (t) => t.status === "ASSIGNED"
      );
    case "active":
      return tasks.filter(
        (t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS"
      );
    case "completed":
      return tasks.filter((t) => t.status === "COMPLETED");
    default:
      return tasks;
  }
}

// ============================================================================
// Page
// ============================================================================

export default async function DriverTasksPage({
  searchParams
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

  // 从服务端读取 session cookie 转发给 API
  const cookieHeader = cookies().toString();
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  let tasks: DriverTaskDTO[] = [];
  let fetchError: string | null = null;

  try {
    const res = await fetch(`${baseUrl}/api/driver/tasks?driverId=${user.driverId}`, {
      headers: {
        cookie: cookieHeader
      },
      cache: "no-store"
    });

    if (res.ok) {
      const json = (await res.json()) as TasksResponse;
      tasks = json.data.tasks;
    } else {
      fetchError = "任务列表加载失败";
    }
  } catch {
    fetchError = "服务暂时不可用";
  }

  const activeTab = searchParams.tab ?? "all";
  const filteredTasks = filterTasks(tasks, activeTab);

  // Tab 计数
  const counts = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === "ASSIGNED").length,
    active: tasks.filter(
      (t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS"
    ).length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length
  };

  return (
    <div className="flex flex-col gap-4 pb-16">
      {/* Tab 切换 */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`/driver/tasks?tab=${tab.key}`}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-xs font-medium transition ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            {tab.label}
            <span className="ml-1 text-slate-400">{counts[tab.key]}</span>
          </a>
        ))}
      </div>

      {/* 错误提示 */}
      {fetchError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {fetchError}
        </div>
      ) : null}

      {/* 空状态 */}
      {!fetchError && filteredTasks.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">
          <p className="text-3xl">📭</p>
          <p className="mt-2">暂无工单</p>
        </div>
      ) : null}

      {/* 工单列表 */}
      <div className="flex flex-col gap-3">
        {filteredTasks.map((task) => (
          <TaskCard
            key={task.taskId}
            task={task}
            driverId={user.driverId!}
          />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TABS } from "../task-tabs";
import type { TabKey } from "../task-tabs";
import { TaskCard } from "./task-card";

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

type TaskListPollerProps = {
  initialTasks: DriverTaskDTO[];
  driverId: string;
  initialTab: string;
  hasFetchError: boolean;
};

// ============================================================================
// 常量
// ============================================================================

const POLL_INTERVAL_MS = 15_000;
const HIGHLIGHT_DURATION_MS = 5_000;

// ============================================================================
// 工具函数
// ============================================================================

function filterTasks(
  tasks: DriverTaskDTO[],
  tab: TabKey
): DriverTaskDTO[] {
  switch (tab) {
    case "pending":
      return tasks.filter((t) => t.status === "ASSIGNED");
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

function computeCounts(tasks: DriverTaskDTO[]) {
  return {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === "ASSIGNED").length,
    active: tasks.filter(
      (t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS"
    ).length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
  };
}

// ============================================================================
// TaskListPoller
// ============================================================================

export function TaskListPoller({
  initialTasks,
  driverId,
  initialTab,
  hasFetchError,
}: TaskListPollerProps) {
  const [tasks, setTasks] = useState<DriverTaskDTO[]>(initialTasks);
  const [activeTab, setActiveTab] = useState<TabKey>(
    (TABS.find((t) => t.key === initialTab)?.key ?? "all") as TabKey
  );
  const [newTaskIds, setNewTaskIds] = useState<Set<string>>(new Set());
  const prevCount = useRef(initialTasks.length);

  // 切换 tab
  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
  }, []);

  // 轮询
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/driver/tasks?driverId=${encodeURIComponent(driverId)}`,
          { cache: "no-store" }
        );

        if (!res.ok) return;

        const json = (await res.json()) as TasksResponse;
        const nextTasks = json.data.tasks;

        // 检测新增工单
        if (nextTasks.length > prevCount.current) {
          const existingIds = new Set(
            tasks.map((t: DriverTaskDTO) => t.taskId)
          );
          const newIds = new Set(
            nextTasks
              .filter((t: DriverTaskDTO) => !existingIds.has(t.taskId))
              .map((t: DriverTaskDTO) => t.taskId)
          );
          setNewTaskIds(newIds);
          setTimeout(() => setNewTaskIds(new Set()), HIGHLIGHT_DURATION_MS);
        }

        prevCount.current = nextTasks.length;
        setTasks(nextTasks);
      } catch {
        // 静默失败，保留上一次数据
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [driverId, tasks]);

  const filteredTasks = filterTasks(tasks, activeTab);
  const counts = computeCounts(tasks);

  return (
    <>
      {/* Tab 切换 */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-xs font-medium transition ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            {tab.label}
            <span className="ml-1 text-slate-400">{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* 错误提示（服务端错误在此展示） */}
      {hasFetchError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          服务暂时不可用
        </div>
      ) : null}

      {/* 空状态（客户端独占，轮询后自动消失） */}
      {!hasFetchError && filteredTasks.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">
          <p className="text-3xl">📭</p>
          <p className="mt-2">暂无工单</p>
        </div>
      ) : null}

      {/* 工单列表 */}
      <div className="flex flex-col gap-3">
        {filteredTasks.map((task) => (
          <div
            key={task.taskId}
            className={
              newTaskIds.has(task.taskId)
                ? "animate-new-task rounded-2xl ring-2 ring-blue-400 ring-offset-2 transition-all duration-500"
                : ""
            }
          >
            <TaskCard
              task={task}
              driverId={driverId}
              highlight={newTaskIds.has(task.taskId)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

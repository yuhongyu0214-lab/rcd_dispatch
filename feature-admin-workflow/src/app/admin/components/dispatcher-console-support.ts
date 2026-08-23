import type {
  ApiResponseV2,
  AssignmentV2,
  DispatchAlertV2,
  DriverV2,
  EtaUnavailableReasonV2,
  OrderV2
} from "@/types/v2";

import type { TimelineSegmentKind } from "./dispatcher-console-model";

export type MapSnapshotData = {
  drivers: DriverV2[];
  orders: OrderV2[];
  openAlertCount: number;
};

export type OrderDetailData = OrderV2 & {
  currentAssignment?: AssignmentV2;
  alerts: DispatchAlertV2[];
  modificationHistory: Array<{
    id: string;
    operator: { id: string; name: string };
    reason: string | null;
    changes: Array<{
      field: string;
      before: string | number | boolean | null;
      after: string | number | boolean | null;
    }>;
    traceId: string | null;
    createdAt: string;
  }>;
};

class DispatcherApiError extends Error {
  code: string;
  traceId: string;

  constructor(message: string, code: string, traceId: string) {
    super(message);
    this.name = "DispatcherApiError";
    this.code = code;
    this.traceId = traceId;
  }
}

export const orderStatusMeta: Record<
  OrderV2["executionStatus"],
  { label: string; icon: string }
> = {
  UNASSIGNED: { label: "未分配", icon: "○" },
  PLANNED: { label: "已计划", icon: "◆" },
  EN_ROUTE: { label: "已出发", icon: "→" },
  IN_SERVICE: { label: "服务中", icon: "◉" },
  COMPLETED: { label: "已完成", icon: "✓" },
  CANCELLED: { label: "已取消", icon: "×" }
};

export const feasibilityMeta: Record<
  OrderV2["feasibility"],
  { label: string; icon: string }
> = {
  UNKNOWN: { label: "待计算", icon: "?" },
  NORMAL: { label: "时间充足", icon: "✓" },
  AT_RISK: { label: "时间风险", icon: "△" },
  INFEASIBLE: { label: "确认无法准时", icon: "!" }
};

export const freshnessMeta: Record<
  DriverV2["locationFreshness"],
  { label: string; icon: string }
> = {
  FRESH: { label: "位置实时", icon: "●" },
  STALE: { label: "位置已过期", icon: "◷" },
  NONE: { label: "暂无位置", icon: "○" }
};

export const segmentMeta: Record<
  TimelineSegmentKind,
  { label: string; icon: string }
> = {
  IDLE: { label: "空闲等待", icon: "Ⅱ" },
  DEADHEAD: { label: "空驶 ETA", icon: "↗" },
  SERVICE_MODULES: { label: "固定服务模块", icon: "▦" },
  ORDER_DRIVE: { label: "订单行驶", icon: "→" }
};

export const etaUnavailableReasonLabel: Record<
  EtaUnavailableReasonV2,
  string
> = {
  AMAP_UNAVAILABLE: "高德路线服务不可用",
  ORIGIN_MISSING: "缺少起点坐标",
  DESTINATION_MISSING: "缺少终点坐标",
  LOCATION_STALE: "司机位置已过期"
};

const shanghaiTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const shanghaiInput = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export function formatTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return shanghaiTime.format(new Date(value));
}

export function toInputTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return shanghaiInput.format(new Date(value)).replace(" ", "T");
}

export function locationAge(value?: string, nowMs = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "未上报";
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds} 秒前更新`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.round(minutes / 60)} 小时前更新`;
}

export function apiErrorMessage(error: unknown) {
  if (error instanceof DispatcherApiError) {
    if (error.code === "PLAN_VERSION_CONFLICT") {
      return `计划已被其他操作更新，请刷新后重试（traceId: ${error.traceId}）`;
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return `实时 ETA 暂不可用，未写入任何计划（traceId: ${error.traceId}）`;
    }
    return `${error.message}（traceId: ${error.traceId}）`;
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

export async function requestV2<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  let payload: ApiResponseV2<T>;
  try {
    payload = (await response.json()) as ApiResponseV2<T>;
  } catch {
    throw new Error("服务返回了无法识别的内容");
  }
  if (!payload.success) {
    throw new DispatcherApiError(
      payload.error.message,
      payload.error.code,
      payload.traceId
    );
  }
  return payload.data;
}

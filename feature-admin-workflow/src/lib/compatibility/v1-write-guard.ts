export type V1WriteGuardMatch = {
  pathname: string;
  guidance: string;
  preserveBrowserExtensionCors: boolean;
};

const STATIC_V1_WRITE_GUIDANCE: Readonly<Record<string, string>> = {
  "/api/assignments": "请改用 /api/v2/assignments 手动分配接口。",
  "/api/assignments/reassign":
    "请改用 /api/v2/assignments/{assignmentId}/reassign 改派接口。",
  "/api/assignments/accept":
    "V2 不再提供接单动作，请使用司机出发、到达、完成流程。",
  "/api/assignments/withdraw":
    "请改用 /api/v2/assignments/{assignmentId}/withdraw 撤回接口。",
  "/api/dispatch/recommend":
    "V2 已改为自动滚动调度，不再提供 Top N 推荐接口。",
  "/api/dispatch/confirm":
    "请改用 /api/v2/assignments 手动分配接口。",
  "/api/driver/location":
    "请改用 /api/v2/driver/location 位置上报接口。",
  "/api/import/orders":
    "请改用 V2 订单接入流程 /api/v2/ingest/orders。",
  "/api/ingest/order":
    "请改用 /api/v2/ingest/orders 订单接入接口。",
  "/api/ingest/browser-extension":
    "请将浏览器插件切换到 /api/v2/ingest/orders 订单接入接口。"
};

const DRIVER_TASK_WRITE_PATTERN =
  /^\/api\/driver\/tasks\/[^/]+\/(accept|complete)$/;

export function isV2StateMachineEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function findV1WriteGuardMatch(
  method: string,
  pathname: string
): V1WriteGuardMatch | null {
  if (method !== "POST") {
    return null;
  }

  const staticGuidance = STATIC_V1_WRITE_GUIDANCE[pathname];
  if (staticGuidance) {
    return {
      pathname,
      guidance: staticGuidance,
      preserveBrowserExtensionCors:
        pathname === "/api/ingest/browser-extension"
    };
  }

  const driverTaskMatch = pathname.match(DRIVER_TASK_WRITE_PATTERN);
  if (!driverTaskMatch) {
    return null;
  }

  return {
    pathname,
    guidance:
      driverTaskMatch[1] === "accept"
        ? "V2 不再提供接单动作，请使用司机出发、到达、完成流程。"
        : "请改用 /api/v2/driver/tasks/{assignmentId}/complete 完成接口。",
    preserveBrowserExtensionCors: false
  };
}

export function buildV1WriteGoneMessage(match: V1WriteGuardMatch): string {
  return `V1 写接口 ${match.pathname} 已停用：V2 状态机已成为唯一事实入口。${match.guidance}`;
}

export function buildV1WriteGoneCorsHeaders(
  match: V1WriteGuardMatch,
  origin: string | null,
  configuredOrigins: string | undefined
): Record<string, string> {
  if (!match.preserveBrowserExtensionCors || !origin) {
    return {};
  }

  const allowedOrigins = (configuredOrigins ?? "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (!allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Ingest-Key, Authorization, X-Trace-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

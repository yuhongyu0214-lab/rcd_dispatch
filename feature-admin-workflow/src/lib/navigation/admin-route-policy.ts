export const ADMIN_MAP_V2_PATH = "/admin/map/v2";
export const ADMIN_ORDERS_V2_PATH = "/admin/orders/v2";
export const DRIVER_TASKS_PATH = "/driver/tasks";

const LEGACY_TOOL_MODES = ["drivers", "vehicles", "alerts", "logs"];

function containsParentDirectorySegment(requestedPath: string) {
  const [rawPathname] = requestedPath.split(/[?#]/, 1);
  let candidate = rawPathname;

  for (let pass = 0; pass < 4; pass += 1) {
    if (candidate.split("/").includes("..")) return true;

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }

  return true;
}

export function resolveAdminOrdersDestination(mode?: string | string[] | null) {
  return typeof mode === "string" && LEGACY_TOOL_MODES.includes(mode)
    ? null
    : ADMIN_ORDERS_V2_PATH;
}

export function resolveSafeLoginPath(requestedPath?: string | string[] | null) {
  if (
    typeof requestedPath !== "string" ||
    !requestedPath.startsWith("/") ||
    requestedPath.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(requestedPath)
  ) {
    return ADMIN_MAP_V2_PATH;
  }

  if (containsParentDirectorySegment(requestedPath)) {
    return ADMIN_MAP_V2_PATH;
  }

  const url = new URL(requestedPath, "https://navigation.invalid");
  const pathname = url.pathname.replace(/\/$/, "");

  if (pathname === "/admin" || pathname === "/admin/map") {
    return ADMIN_MAP_V2_PATH;
  }

  if (pathname === "/admin/orders") {
    const mode = url.searchParams.get("mode");
    const exactLegacyToolPath = `/admin/orders?mode=${mode}`;
    return resolveAdminOrdersDestination(mode) === null &&
      requestedPath === exactLegacyToolPath
      ? requestedPath
      : ADMIN_ORDERS_V2_PATH;
  }

  if (
    pathname === ADMIN_MAP_V2_PATH ||
    pathname === ADMIN_ORDERS_V2_PATH ||
    pathname === "/admin/import" ||
    pathname === "/admin/import/result"
  ) {
    return `${pathname}${url.search}${url.hash}`;
  }

  return requestedPath === DRIVER_TASKS_PATH
    ? DRIVER_TASKS_PATH
    : ADMIN_MAP_V2_PATH;
}

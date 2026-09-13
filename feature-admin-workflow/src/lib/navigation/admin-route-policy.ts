export const ADMIN_MAP_V2_PATH = "/admin/map/v2";
export const ADMIN_ORDERS_V2_PATH = "/admin/orders/v2";
export const DRIVER_TASKS_PATH = "/driver/tasks";

const LEGACY_TOOL_MODES = ["drivers", "vehicles", "alerts", "logs"];

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

  const url = new URL(requestedPath, "https://navigation.invalid");
  const pathname = url.pathname.replace(/\/$/, "");

  if (pathname === "/admin" || pathname === "/admin/map") {
    return ADMIN_MAP_V2_PATH;
  }

  if (pathname === "/admin/orders") {
    const modes = url.searchParams.getAll("mode");
    const destination = resolveAdminOrdersDestination(
      modes.length === 1 ? modes[0] : modes
    );
    return destination ?? `${pathname}${url.search}${url.hash}`;
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

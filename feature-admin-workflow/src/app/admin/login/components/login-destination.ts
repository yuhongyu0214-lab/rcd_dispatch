import { isAdminRole } from "@/lib/auth/roles";

type LoginIdentity = {
  role: string;
  driverId?: string | null;
};

const DEFAULT_LOGIN_PATH = "/admin/map";
const DRIVER_TASKS_PATH = "/driver/tasks";

export function resolveSafeLoginPath(requestedPath?: string | null) {
  if (
    requestedPath === DRIVER_TASKS_PATH ||
    requestedPath === "/admin" ||
    requestedPath?.startsWith("/admin/")
  ) {
    return requestedPath;
  }

  return DEFAULT_LOGIN_PATH;
}

export function resolveLoginDestination(
  identity: LoginIdentity,
  requestedPath: string
) {
  // 缺少司机档案时在 H5 内完善资料，不再跳回 Web 或首页。
  return isAdminRole(identity.role) ? resolveSafeLoginPath(requestedPath) : "/";
}

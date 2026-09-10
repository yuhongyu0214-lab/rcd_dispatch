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
  const safeRequestedPath = resolveSafeLoginPath(requestedPath);

  if (identity.role === "driver") {
    return identity.driverId ? DRIVER_TASKS_PATH : DEFAULT_LOGIN_PATH;
  }

  if (safeRequestedPath === DRIVER_TASKS_PATH) {
    return identity.driverId ? DRIVER_TASKS_PATH : DEFAULT_LOGIN_PATH;
  }

  return safeRequestedPath;
}

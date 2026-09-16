import { isAdminRole } from "@/lib/auth/roles";
import {
  DRIVER_TASKS_PATH,
  resolveSafeLoginPath
} from "@/lib/navigation/admin-route-policy";

type LoginIdentity = {
  role: string;
  driverId?: string | null;
};

export function resolveLoginDestination(
  identity: LoginIdentity,
  requestedPath?: string | string[] | null
) {
  if (!isAdminRole(identity.role)) {
    return "/";
  }

  // 历史纯司机账号仍默认进入 H5；缺档案时在 H5 内完成本人档案。
  if (identity.role === "driver") {
    return DRIVER_TASKS_PATH;
  }

  return resolveSafeLoginPath(requestedPath);
}

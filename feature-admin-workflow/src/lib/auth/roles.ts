/** 注册用户统一拥有 Web 调度和司机 H5 入口；保留历史 role，无需批量改库。 */
export const ADMIN_ROLES = ["admin", "dispatcher", "driver"] as const;

/** 系统级角色（含内部服务账号） */
export const SYSTEM_ROLES = ["admin", "dispatcher", "system"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** 判断角色是否有后台管理权限 */
export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** 判断角色是否有系统级权限（含内部服务） */
export function isSystemRole(role: string): boolean {
  return (SYSTEM_ROLES as readonly string[]).includes(role);
}

export type TaskNavigationTarget = "PICKUP" | "RETURN";

export function getTaskNavigationTarget(
  businessType: string
): TaskNavigationTarget | null {
  if (businessType === "STORE_PICKUP" || businessType === "DOOR_DELIVERY") {
    return "PICKUP";
  }
  if (businessType === "STORE_RETURN" || businessType === "DOOR_PICKUP") {
    return "RETURN";
  }
  return null;
}

export function getVisibleDisplayValue(
  value: string | null | undefined
): string | null {
  if (value == null || value.startsWith("[G3E2E]")) return null;
  return value;
}

import type { ServiceModuleV2 } from "@/types/v2";

export const SERVICE_MODULE_DURATIONS_MINUTES = {
  CHARGING: 30,
  REFUELING: 5,
  WASHING: 10,
  HANDOVER_FORMALITIES: 10,
  RETURN_FORMALITIES: 5
} as const satisfies Record<ServiceModuleV2, number>;

export function sumServiceModuleMinutes(
  modules: readonly ServiceModuleV2[]
): number {
  return modules.reduce(
    (total, module) => total + SERVICE_MODULE_DURATIONS_MINUTES[module],
    0
  );
}

import type { ServiceModuleV2 } from "@/types/v2";

export const DRIVER_SERVICE_MODULES = [
  "CHARGING",
  "REFUELING",
  "WASHING",
  "HANDOVER_FORMALITIES",
  "RETURN_FORMALITIES"
] as const satisfies readonly ServiceModuleV2[];

const serviceModuleSet = new Set<string>(DRIVER_SERVICE_MODULES);

export function isServiceModuleV2(value: unknown): value is ServiceModuleV2 {
  return typeof value === "string" && serviceModuleSet.has(value);
}

export function normalizeServiceModules(
  modules: readonly ServiceModuleV2[]
): ServiceModuleV2[] {
  const selected = new Set(modules);
  return DRIVER_SERVICE_MODULES.filter((module) => selected.has(module));
}

export function parseStoredServiceModules(value: unknown): ServiceModuleV2[] {
  if (!Array.isArray(value)) return [];
  return normalizeServiceModules(value.filter(isServiceModuleV2));
}

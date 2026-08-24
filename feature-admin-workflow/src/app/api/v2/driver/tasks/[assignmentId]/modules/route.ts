import { extractDriverId } from "@/app/api/driver/_utils";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { updateDriverServiceModules } from "@/lib/driver-v2/module-command-service";
import {
  isServiceModuleV2,
  normalizeServiceModules
} from "@/lib/driver-v2/service-modules";
import { createLogger } from "@/lib/logger";

import type { ServiceModuleV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

const log = createLogger("driver-module-route-v2");

export async function PUT(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const driverId = await extractDriverId(request);
  if (!driverId) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Driver authentication required"),
      { traceId }
    );
  }

  const assignmentId = (await context.params).assignmentId?.trim();
  if (!assignmentId) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Assignment ID is required", {
        fields: { assignmentId: ["Required"] }
      }),
      { traceId }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Expected object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Request body must be a JSON object",
        { fields: { body: ["Expected valid JSON object"] } }
      ),
      { traceId }
    );
  }

  const fields: Record<string, string[]> = {};
  if (Object.prototype.hasOwnProperty.call(body, "expectedPlanVersion")) {
    fields.expectedPlanVersion = ["Must not be provided"];
  }
  const rawModules = body.modules;
  let modules: ServiceModuleV2[] = [];
  if (!Array.isArray(rawModules)) {
    fields.modules = ["Expected an array"];
  } else if (!rawModules.every(isServiceModuleV2)) {
    fields.modules = ["Contains an unsupported service module"];
  } else if (new Set(rawModules).size !== rawModules.length) {
    fields.modules = ["Must not contain duplicate modules"];
  } else {
    modules = normalizeServiceModules(rawModules);
  }

  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid service module command", {
        fields
      }),
      { traceId }
    );
  }

  try {
    const result = await updateDriverServiceModules({
      assignmentId,
      driverId,
      modules,
      traceId
    });
    return result.success
      ? okV2(result.data, { traceId })
      : failV2(result.error, { traceId });
  } catch (error) {
    log.error("driver_module_route_failed", {
      assignmentId,
      driverId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Service module update failed"),
      { traceId }
    );
  }
}

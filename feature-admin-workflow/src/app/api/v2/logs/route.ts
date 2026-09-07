import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { createLogger } from "@/lib/logger";
import { listOperationLogs } from "@/lib/observability-v2/read-service";
import { getOrCreateTraceId } from "@/lib/observability-v2/trace";

import { OPERATION_ACTIONS_V2, type OperationActionV2 } from "@/types/v2";

const log = createLogger("v2-logs-api");

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export async function GET(request: Request) {
  const traceId = getOrCreateTraceId(request.headers);
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return failV2(
        createApiErrorV2("UNAUTHORIZED", "Dispatcher authentication required"),
        { traceId }
      );
    }
    if (!isAdminRole(currentUser.role)) {
      return failV2(createApiErrorV2("FORBIDDEN", "Dispatcher role required"), {
        traceId
      });
    }

    const search = new URL(request.url).searchParams;
    const page = positiveInteger(search.get("page"), 1);
    const requestedPageSize = positiveInteger(search.get("pageSize"), 20);
    const action = search.get("action")?.trim() || undefined;
    const fields: Record<string, string[]> = {};
    if (page === null) fields.page = ["Expected positive integer"];
    if (requestedPageSize === null) {
      fields.pageSize = ["Expected positive integer"];
    }
    if (
      action &&
      !(OPERATION_ACTIONS_V2 as readonly string[]).includes(action)
    ) {
      fields.action = ["Unsupported operation action"];
    }
    if (Object.keys(fields).length > 0) {
      return failV2(
        createApiErrorV2("VALIDATION_FAILED", "Invalid operation log query", {
          fields
        }),
        { traceId }
      );
    }

    return okV2(
      await listOperationLogs({
        page: page!,
        pageSize: Math.min(requestedPageSize!, 100),
        orderId: search.get("orderId")?.trim() || undefined,
        driverId: search.get("driverId")?.trim() || undefined,
        traceId: search.get("traceId")?.trim() || undefined,
        action: action as OperationActionV2 | undefined
      }),
      { traceId }
    );
  } catch (error) {
    log.error("operation_logs_read_failed", {
      traceId,
      errorType: error instanceof Error ? error.name : typeof error
    });
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read operation logs"),
      { traceId }
    );
  }
}

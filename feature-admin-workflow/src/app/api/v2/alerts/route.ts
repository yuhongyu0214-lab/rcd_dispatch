import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { createLogger } from "@/lib/logger";
import { listAlerts } from "@/lib/observability-v2/read-service";
import { getOrCreateTraceId } from "@/lib/observability-v2/trace";

const log = createLogger("v2-alerts-api");

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
    const status = search.get("status")?.trim() || undefined;
    const fields: Record<string, string[]> = {};
    if (page === null) fields.page = ["Expected positive integer"];
    if (requestedPageSize === null) {
      fields.pageSize = ["Expected positive integer"];
    }
    if (status && status !== "OPEN" && status !== "RESOLVED") {
      fields.status = ["Expected OPEN or RESOLVED"];
    }
    if (Object.keys(fields).length > 0) {
      return failV2(
        createApiErrorV2("VALIDATION_FAILED", "Invalid alert query", {
          fields
        }),
        { traceId }
      );
    }

    return okV2(
      await listAlerts({
        page: page!,
        pageSize: Math.min(requestedPageSize!, 100),
        status: status as "OPEN" | "RESOLVED" | undefined
      }),
      { traceId }
    );
  } catch (error) {
    log.error("alerts_read_failed", {
      traceId,
      errorType: error instanceof Error ? error.name : typeof error
    });
    return failV2(createApiErrorV2("INTERNAL_ERROR", "Failed to read alerts"), {
      traceId
    });
  }
}

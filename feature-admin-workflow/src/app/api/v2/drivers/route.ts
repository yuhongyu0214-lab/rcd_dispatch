import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { listDrivers } from "@/lib/dispatcher-v2/read-service";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return failV2(
      createApiErrorV2("UNAUTHORIZED", "Dispatcher authentication required"),
      { traceId }
    );
  }
  if (!isAdminRole(currentUser.role)) {
    return failV2(
      createApiErrorV2("FORBIDDEN", "Dispatcher role required"),
      { traceId }
    );
  }

  const search = new URL(request.url).searchParams;
  const page = positiveInteger(search.get("page"), 1);
  const requestedPageSize = positiveInteger(search.get("pageSize"), 20);
  const fields: Record<string, string[]> = {};
  if (page === null) fields.page = ["Expected positive integer"];
  if (requestedPageSize === null) {
    fields.pageSize = ["Expected positive integer"];
  }
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid driver query", {
        fields
      }),
      { traceId }
    );
  }
  try {
    return okV2(
      await listDrivers({
        page: page!,
        pageSize: Math.min(requestedPageSize!, 100)
      }),
      { traceId }
    );
  } catch {
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read drivers"),
      { traceId }
    );
  }
}

import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { getMapSnapshot } from "@/lib/dispatcher-v2/read-service";

export const dynamic = "force-dynamic";

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

  try {
    return okV2(await getMapSnapshot(), { traceId });
  } catch {
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read map snapshot"),
      { traceId }
    );
  }
}

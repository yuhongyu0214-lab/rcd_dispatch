import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { listOrders } from "@/lib/dispatcher-v2/read-service";

import {
  EXECUTION_STATUSES_V2,
  ORDER_FEASIBILITIES_V2,
  type ExecutionStatusV2,
  type OrderFeasibilityV2
} from "@/types/v2";

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
  const executionStatus = search.get("executionStatus")?.trim();
  const feasibility = search.get("feasibility")?.trim();
  const slot = search.get("slot")?.trim();
  const fields: Record<string, string[]> = {};
  if (page === null) fields.page = ["Expected positive integer"];
  if (requestedPageSize === null) {
    fields.pageSize = ["Expected positive integer"];
  }
  if (
    executionStatus &&
    !(EXECUTION_STATUSES_V2 as readonly string[]).includes(executionStatus)
  ) {
    fields.executionStatus = ["Unsupported execution status"];
  }
  if (
    feasibility &&
    !(ORDER_FEASIBILITIES_V2 as readonly string[]).includes(feasibility)
  ) {
    fields.feasibility = ["Unsupported feasibility"];
  }
  if (slot && !["NONE", "A", "B", "C"].includes(slot)) {
    fields.slot = ["Expected NONE, A, B, or C"];
  }
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid order query", {
        fields
      }),
      { traceId }
    );
  }

  try {
    const data = await listOrders({
      page: page!,
      pageSize: Math.min(requestedPageSize!, 100),
      executionStatus: executionStatus as ExecutionStatusV2 | undefined,
      feasibility: feasibility as OrderFeasibilityV2 | undefined,
      slot: slot as "NONE" | "A" | "B" | "C" | undefined,
      storeCode: search.get("storeCode")?.trim() || undefined,
      keyword: search.get("keyword")?.trim() || undefined
    });
    return okV2(data, { traceId });
  } catch {
    return failV2(
      createApiErrorV2("INTERNAL_ERROR", "Failed to read orders"),
      { traceId }
    );
  }
}

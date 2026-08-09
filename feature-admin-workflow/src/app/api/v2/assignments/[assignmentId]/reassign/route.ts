import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { reassignAssignment } from "@/lib/assignments-v2/assignment-command-service";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";

import type { ReassignCommandV2 } from "@/types/v2";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
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

  const assignmentId = (await context.params).assignmentId?.trim();
  if (!assignmentId) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Assignment ID is required",
        { fields: { assignmentId: ["Required"] } }
      ),
      { traceId }
    );
  }

  let body: Partial<ReassignCommandV2>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("INVALID_BODY");
    }
    body = parsed as Partial<ReassignCommandV2>;
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
  const toDriverId = body.toDriverId?.trim();
  const reason = body.reason?.trim();

  if (!toDriverId) fields.toDriverId = ["Required"];
  if (!reason) fields.reason = ["Required"];
  if (!Number.isSafeInteger(body.expectedFromPlanVersion)) {
    fields.expectedFromPlanVersion = ["Expected integer"];
  }
  if (!Number.isSafeInteger(body.expectedToPlanVersion)) {
    fields.expectedToPlanVersion = ["Expected integer"];
  }

  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Invalid reassignment command",
        { fields }
      ),
      { traceId }
    );
  }

  const result = await reassignAssignment({
    assignmentId,
    toDriverId: toDriverId!,
    reason: reason!,
    expectedFromPlanVersion: body.expectedFromPlanVersion!,
    expectedToPlanVersion: body.expectedToPlanVersion!,
    operatorUserId: currentUser.id,
    traceId
  });

  if (!result.success) {
    return failV2(result.error, { traceId });
  }

  return okV2(result.data, { traceId });
}

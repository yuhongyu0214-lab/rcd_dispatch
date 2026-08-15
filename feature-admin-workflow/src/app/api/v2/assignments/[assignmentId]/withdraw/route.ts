import { withdrawAssignment } from "@/lib/assignments-v2/assignment-command-service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";

import type { PlanEditCommandV2 } from "@/types/v2";

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
      createApiErrorV2("VALIDATION_FAILED", "Assignment ID is required", {
        fields: { assignmentId: ["Required"] }
      }),
      { traceId }
    );
  }

  let body: Partial<PlanEditCommandV2>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failV2(
        createApiErrorV2(
          "VALIDATION_FAILED",
          "Request body must be a JSON object",
          { fields: { body: ["Expected valid JSON object"] } }
        ),
        { traceId }
      );
    }
    body = parsed as Partial<PlanEditCommandV2>;
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
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) fields.reason = ["Required"];
  if (!Number.isSafeInteger(body.expectedPlanVersion)) {
    fields.expectedPlanVersion = ["Expected integer"];
  }
  if (Object.keys(fields).length > 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "Invalid withdrawal command", {
        fields
      }),
      { traceId }
    );
  }

  const result = await withdrawAssignment({
    assignmentId,
    reason,
    expectedPlanVersion: body.expectedPlanVersion!,
    operatorUserId: currentUser.id,
    traceId
  });
  return result.success
    ? okV2(result.data, { traceId })
    : failV2(result.error, { traceId });
}

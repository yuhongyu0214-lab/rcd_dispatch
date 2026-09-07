import { extractDriverId } from "@/app/api/driver/_utils";
import {
  executeDriverAssignmentAction,
  type DriverExecutionAction
} from "@/lib/assignments-v2/assignment-command-service";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";

export async function handleDriverAssignmentAction(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
  action: DriverExecutionAction
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
      createApiErrorV2(
        "VALIDATION_FAILED",
        "Assignment ID is required",
        { fields: { assignmentId: ["Required"] } }
      ),
      { traceId }
    );
  }

  const result = await executeDriverAssignmentAction({
    action,
    assignmentId,
    driverId,
    traceId
  });

  if (!result.success) {
    return failV2(result.error, { traceId });
  }

  return okV2(result.data, { traceId });
}

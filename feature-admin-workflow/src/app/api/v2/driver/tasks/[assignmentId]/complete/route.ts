import { handleDriverAssignmentAction } from "../_action-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return handleDriverAssignmentAction(request, context, "COMPLETE");
}

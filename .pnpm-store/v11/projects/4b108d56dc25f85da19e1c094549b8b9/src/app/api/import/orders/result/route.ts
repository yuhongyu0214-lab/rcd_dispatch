import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { getImportResult } from "@/lib/import/orchestrators/get-import-result";

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录后查看导入结果", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("当前账号无权限查看导入结果", { status: 403, traceId });
  }

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId")?.trim();

  if (!batchId) {
    return fail("缺少 batchId 参数", { status: 400, traceId });
  }

  try {
    const result = await getImportResult(batchId);

    if (!result) {
      return fail("未找到对应的导入结果批次", { status: 404, traceId });
    }

    return ok(result, { traceId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "获取导入结果失败";

    return fail(message, { status: 500, traceId });
  }
}

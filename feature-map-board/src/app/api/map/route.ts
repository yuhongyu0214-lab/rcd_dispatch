import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMapBoardData } from "@/lib/map/points";
import { getTraceId } from "@/lib/middleware/trace";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录后查看地图看板", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限查看地图看板", { status: 403, traceId });
  }

  try {
    const payload = await getMapBoardData();
    return ok(payload, { traceId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "地图看板数据加载失败，请稍后重试";

    return fail(message, {
      status: 500,
      traceId
    });
  }
}

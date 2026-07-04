import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import { getMapBoardData } from "@/lib/map/points";
import type { GetMapBoardParams } from "@/lib/map/points";

export async function GET(request: NextRequest) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录后查看地图看板", { status: 401, traceId });
  }

  if (!isAdminRole(currentUser.role)) {
    return fail("当前账号无权限查看地图看板", { status: 403, traceId });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const storeId = searchParams.get("storeId") || undefined;
    const objectTypeRaw = searchParams.get("objectType") || undefined;
    const objectTypes = objectTypeRaw ? objectTypeRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    const params: GetMapBoardParams = {};
    if (storeId) params.storeId = storeId;
    if (objectTypes) params.objectTypes = objectTypes;

    const payload = await getMapBoardData(params);
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

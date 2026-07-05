import { ok, fail } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/stores
 * 获取所有可用门店列表（无需鉴权，供注册页等公开场景使用）
 */
export async function GET() {
  try {
    const stores = await prisma.store.findMany({
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: { code: "asc" },
    });

    return ok({ stores });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "门店列表加载失败";
    return fail(message, { status: 500 });
  }
}

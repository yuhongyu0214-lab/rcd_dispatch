/**
 * POST /api/driver/location — 司机位置上报。
 *
 * 写入 driver_locations 表，每 3–5 分钟由司机移动端自动上报。
 * V1 使用 x-driver-id 请求头标识司机身份（真实接入时替换为司机端 Token）。
 */
import { fail, ok } from "@/lib/api-response";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

type LocationRequestBody = {
  lat?: number;
  lng?: number;
};

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const driverId = request.headers.get("x-driver-id")?.trim();

  if (!driverId) {
    return fail("缺少司机身份标识（x-driver-id 请求头）", { status: 401, traceId });
  }

  let body: LocationRequestBody;

  try {
    body = (await request.json()) as LocationRequestBody;
  } catch {
    return fail("请求体格式错误", { status: 400, traceId });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return fail("纬度 lat 无效，应为 -90 到 90 之间的数字", { status: 400, traceId });
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return fail("经度 lng 无效，应为 -180 到 180 之间的数字", { status: 400, traceId });
  }

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, isActive: true }
    });

    if (!driver) {
      return fail("司机不存在", { status: 404, traceId });
    }

    if (!driver.isActive) {
      return fail("司机账号已停用", { status: 403, traceId });
    }

    const location = await prisma.driverLocation.create({
      data: {
        driverId,
        lat,
        lng,
        timestamp: new Date()
      }
    });

    return ok({
      id: location.id,
      driverId: location.driverId,
      lat: location.lat,
      lng: location.lng,
      timestamp: location.timestamp.toISOString()
    }, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "位置上报失败";
    return fail(message, { status: 500, traceId });
  }
}

import type { OrderType } from "@/types";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { geocodeAddress } from "@/lib/import/services/geocode";

const ingestLog = createLogger("order-ingest");

/**
 * 浏览器插件 JSON 入单接口
 *
 * POST /api/ingest/order
 * Header: X-Ingest-Key: <your_ingest_key>
 *
 * 浏览器插件抓取外部平台订单后 POST JSON 直接写入 RDS。
 * 不需要登录态，通过 Ingest Key 做轻量鉴权。
 */
export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // 轻量鉴权
  const ingestKey = request.headers.get("X-Ingest-Key");
  if (!ingestKey || ingestKey !== process.env.INGEST_API_KEY) {
    return fail("无效的 Ingest Key", { status: 401, traceId });
  }

  try {
    const body = await request.json();

    // 必填字段校验
    const required = [
      "orderNo", "type", "storeCode", "pickupAddress",
      "returnAddress", "scheduledAt"
    ] as const;

    const missing = required.filter((f) => !body[f]);
    if (missing.length > 0) {
      return fail(`缺少必填字段: ${missing.join(", ")}`, {
        status: 400, traceId
      });
    }

    const orderType = body.type as OrderType;
    const validTypes: OrderType[] = [
      "STORE_PICKUP", "STORE_RETURN", "DOOR_DELIVERY", "DOOR_PICKUP"
    ];
    if (!validTypes.includes(orderType)) {
      return fail(`无效订单类型: ${validTypes.join("/")}`, {
        status: 400, traceId
      });
    }

    // 查门店
    const store = await prisma.store.findFirst({
      where: { code: body.storeCode, isActive: true }
    });
    if (!store) {
      return fail(`门店不存在或已停用: ${body.storeCode}`, {
        status: 400, traceId
      });
    }

    // 去重
    const existing = await prisma.order.findUnique({
      where: { orderNo: body.orderNo },
      select: { id: true }
    });
    if (existing) {
      return fail(`订单 ${body.orderNo} 已存在，跳过重复写入`, {
        status: 409, traceId
      });
    }

    // ── 地理编码（仅坐标缺失时调用，节省高德 API 额度）──
    const needPickupGeo = body.pickupLat == null || body.pickupLng == null;
    const needReturnGeo = body.returnLat == null || body.returnLng == null;

    const [pickupGeo, returnGeo] = await Promise.all([
      needPickupGeo ? geocodeAddress(body.pickupAddress, "取车地址") : null,
      needReturnGeo ? geocodeAddress(body.returnAddress, "还车地址") : null,
    ]);

    // ── 坐标取值优先级：请求体显式传入 > 地理编码回退 ──
    const pickupLat = body.pickupLat ?? (pickupGeo?.success ? pickupGeo.lat : null);
    const pickupLng = body.pickupLng ?? (pickupGeo?.success ? pickupGeo.lng : null);
    const returnLat = body.returnLat ?? (returnGeo?.success ? returnGeo.lat : null);
    const returnLng = body.returnLng ?? (returnGeo?.success ? returnGeo.lng : null);

    // 写入 RDS
    const order = await prisma.order.create({
      data: {
        orderNo: body.orderNo,
        type: orderType,
        status: "PENDING",
        storeId: store.id,
        channel: body.channel ?? "BROWSER_PLUGIN",
        driverNameSnapshot: body.driverName ?? null,
        vehicleTypeSnapshot: body.vehicleType ?? null,
        licensePlateSnapshot: body.licensePlate ?? null,
        pickupAddress: body.pickupAddress,
        pickupLat,
        pickupLng,
        returnAddress: body.returnAddress,
        returnLat,
        returnLng,
        scheduledAt: new Date(body.scheduledAt),
      }
    });

    ingestLog.info("插件入单成功", {
      traceId,
      orderNo: order.orderNo,
      storeCode: body.storeCode,
      channel: body.channel,
      geocoded: pickupGeo?.success || returnGeo?.success || false,
    });

    return ok({
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
    }, { traceId });

  } catch (error) {
    const message = error instanceof Error ? error.message : "入单失败";
    ingestLog.error("入单异常", { traceId, error: message });
    return fail(message, { status: 500, traceId });
  }
}

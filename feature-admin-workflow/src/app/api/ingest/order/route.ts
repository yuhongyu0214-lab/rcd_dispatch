import type { OrderType } from "@/types";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { geocodeAddress } from "@/lib/import/services/geocode";
import {
  buildGeocodeAddress,
  isValidPilotCity,
  mapOrderStatusRaw,
  mapOrderTypeRaw,
  PILOT_CITIES,
} from "@/lib/ingest/normalize";

const ingestLog = createLogger("order-ingest");

/**
 * 统一 JSON 入单接口
 *
 * POST /api/ingest/order
 * Header: X-Ingest-Key: <your_ingest_key>
 *
 * 接收浏览器插件/RDS 的标准化订单数据，外部原始字段经映射后写入 RDS。
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
      "orderNo", "pickupAddress", "returnAddress", "scheduledAt"
    ] as const;

    const missing = required.filter((f) => !body[f]);
    if (missing.length > 0) {
      return fail(`缺少必填字段: ${missing.join(", ")}`, {
        status: 400, traceId
      });
    }

    // ── 订单类型映射：优先从外部原始文本映射，回退到直接传系统枚举 ──
    let orderType: OrderType;
    const mappedType = mapOrderTypeRaw(body.orderTypeRaw);
    if (mappedType) {
      orderType = mappedType;
    } else if (body.type) {
      const validTypes: OrderType[] = [
        "STORE_PICKUP", "STORE_RETURN", "DOOR_DELIVERY", "DOOR_PICKUP"
      ];
      if (!validTypes.includes(body.type as OrderType)) {
        return fail(`无效订单类型: ${validTypes.join("/")}`, { status: 400, traceId });
      }
      orderType = body.type as OrderType;
    } else {
      return fail("缺少订单类型（orderTypeRaw 或 type）", { status: 400, traceId });
    }

    // ── 订单状态映射：优先从外部原始状态映射，回退到 PENDING ──
    const orderStatus = mapOrderStatusRaw(body.orderStatusRaw) ?? "PENDING";

    // ── 城市校验 ──
    const province = body.province?.trim() || null;
    const city = body.city?.trim();
    if (city && !isValidPilotCity(city)) {
      return fail(`城市 "${city}" 不在试点范围内，首批仅支持：${PILOT_CITIES.join("、")}`, {
        status: 400, traceId
      });
    }
    const district = body.district?.trim() || null;

    // ── 门店匹配（优先 storeCode 否则 storeName）──
    let store = body.storeCode
      ? await prisma.store.findFirst({ where: { code: body.storeCode, isActive: true } })
      : null;
    if (!store && body.storeName) {
      store = await prisma.store.findFirst({
        where: { name: { contains: body.storeName }, isActive: true }
      });
    }
    if (!store) {
      return fail(`门店不存在或已停用: ${body.storeCode ?? body.storeName}`, {
        status: 400, traceId
      });
    }

    // ── 去重 ──
    const existing = await prisma.order.findUnique({
      where: { orderNo: body.orderNo },
      select: { id: true }
    });
    if (existing) {
      return fail(`订单 ${body.orderNo} 已存在，跳过重复写入`, {
        status: 409, traceId
      });
    }

    // ── 地理编码（拼接省市+区县提高短地址命中率）──
    const pickupGeoInput = buildGeocodeAddress(body.pickupAddress, { province, city, district });
    const returnGeoInput = buildGeocodeAddress(body.returnAddress, { province, city, district });

    // 坐标取值优先级：请求体显式传入 > 地理编码回退
    const hasExplicitPickupCoord =
      body.pickupLat != null && body.pickupLng != null;
    const hasExplicitReturnCoord =
      body.returnLat != null && body.returnLng != null;

    const [pickupGeo, returnGeo] = await Promise.all([
      hasExplicitPickupCoord
        ? null
        : geocodeAddress(pickupGeoInput.fullAddress, "取车地址", pickupGeoInput.cityParam || undefined),
      hasExplicitReturnCoord
        ? null
        : geocodeAddress(returnGeoInput.fullAddress, "还车地址", returnGeoInput.cityParam || undefined),
    ]);

    const pickupLat = body.pickupLat ?? (pickupGeo?.success ? pickupGeo.lat : null);
    const pickupLng = body.pickupLng ?? (pickupGeo?.success ? pickupGeo.lng : null);
    const returnLat = body.returnLat ?? (returnGeo?.success ? returnGeo.lat : null);
    const returnLng = body.returnLng ?? (returnGeo?.success ? returnGeo.lng : null);

    const geocodePickupStatus = hasExplicitPickupCoord
      ? "FROM_SOURCE"
      : (pickupGeo?.geocodeStatus ?? "FAILED");
    const geocodeReturnStatus = hasExplicitReturnCoord
      ? "FROM_SOURCE"
      : (returnGeo?.geocodeStatus ?? "FAILED");

    // ── 写入 RDS ──
    const order = await prisma.order.create({
      data: {
        orderNo: body.orderNo,
        type: orderType,
        status: orderStatus,
        storeId: store.id,
        channel: body.source ?? body.channel ?? "BROWSER_PLUGIN",
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
        geocodePickupStatus,
        geocodeReturnStatus,
      }
    });

    ingestLog.info("入单成功", {
      traceId,
      orderNo: order.orderNo,
      orderType,
      orderStatus,
      storeCode: store.code,
      province: province ?? null,
      city: city ?? null,
      geocodePickupStatus,
      geocodeReturnStatus,
      source: body.source ?? body.channel ?? "BROWSER_PLUGIN",
    });

    return ok({
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      type: orderType,
      geocodePickupStatus,
      geocodeReturnStatus,
    }, { traceId });

  } catch (error) {
    const message = error instanceof Error ? error.message : "入单失败";
    ingestLog.error("入单异常", { traceId, error: message });
    return fail(message, { status: 500, traceId });
  }
}

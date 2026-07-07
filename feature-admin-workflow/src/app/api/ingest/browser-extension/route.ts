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

const log = createLogger("browser-extension-ingest");

/**
 * 浏览器插件 JSON 入单接口
 *
 * POST /api/ingest/browser-extension
 * Header: X-Ingest-Key: <ingest_key>
 *
 * 接收浏览器插件从外部平台抓取的订单数据，字段映射后写入 RDS。
 * 不需要登录态，通过 Ingest Key 鉴权。
 */

/** 插件 POST 过来的原始 JSON 结构 */
interface ExtensionRecord {
  order_number: string;
  driver_name: string;
  pickup_time: string;
  delivery_driver: string;
  return_time: string;
  return_driver: string;
  car_model: string;
  license_plate: string;
  pickup_store: string;
  pickup_address: string;
  return_store: string;
  return_address: string;
  order_source: string;
  order_status: string;
  captured_at: string;
  // 新增：地理编码和字段标准化所需
  province?: string;
  city?: string;
  district?: string;
  order_status_raw?: string;
  order_type_raw?: string;
}

/**
 * 从门店名称查找 store code
 * 策略：先用门店全名模糊匹配，失败则用店名前缀
 */
async function resolveStoreCode(storeName: string): Promise<string | null> {
  if (!storeName) return null;

  // 精确匹配店名
  let store = await prisma.store.findFirst({
    where: { name: { contains: storeName }, isActive: true },
  });
  if (store) return store.code;

  // 截取"店"字前面的部分再试（如 "上海虹桥店" → "虹桥"）
  const shortName = storeName.replace(/店$/, "").replace(/^[^\s]+/, "");
  if (shortName && shortName !== storeName) {
    store = await prisma.store.findFirst({
      where: { name: { contains: shortName }, isActive: true },
    });
    if (store) return store.code;
  }

  return null;
}

/**
 * 解析日期字符串为 Date 对象
 * 兼容格式：YYYY-MM-DD HH:MM(:SS)?, YYYY/MM/DD HH:MM
 */
function parseDate(raw: string): Date | null {
  if (!raw) return null;
  // 统一分隔符
  const normalized = raw.replace(/\//g, "-");
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // 轻量鉴权（支持两种格式：X-Ingest-Key 和 Authorization: Bearer）
  const ingestKey =
    request.headers.get("X-Ingest-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!ingestKey || ingestKey !== process.env.INGEST_API_KEY) {
    return fail("无效的 Ingest Key", { status: 401, traceId });
  }

  try {
    const body = await request.json();
    const record = body as ExtensionRecord;

    // ── 必填字段校验 ──
    if (!record.order_number) {
      return fail("缺少必填字段: order_number（订单号）", { status: 400, traceId });
    }
    if (!record.pickup_address && !record.pickup_store) {
      return fail("缺少取车地址", { status: 400, traceId });
    }
    if (!record.return_address && !record.return_store) {
      return fail("缺少还车地址", { status: 400, traceId });
    }

    // ── 去重 ──
    const existing = await prisma.order.findUnique({
      where: { orderNo: record.order_number },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      return fail(`订单 ${record.order_number} 已存在，跳过`, {
        status: 409, traceId,
      });
    }

    // ── 门店查找 ──
    const storeName = record.pickup_store || record.return_store || "";
    const storeCode = await resolveStoreCode(storeName);
    if (!storeCode) {
      return fail(`无法匹配门店: ${storeName}，请先在系统中创建对应门店`, {
        status: 400, traceId,
      });
    }

    const store = await prisma.store.findUnique({ where: { code: storeCode } });
    if (!store) {
      return fail(`门店不存在: ${storeCode}`, { status: 400, traceId });
    }

    // ── 订单类型映射（优先外部原始文本，回退地址推断）──
    let orderType: OrderType;
    const mappedType =
      mapOrderTypeRaw(record.order_type_raw) ??
      mapOrderTypeRaw(record.order_status); // 兼容旧字段名
    if (mappedType) {
      orderType = mappedType;
    } else {
      // 回退：从地址文本推断
      const fullText = `${record.pickup_address ?? ""} ${record.pickup_store ?? ""} ${record.return_address ?? ""} ${record.return_store ?? ""}`;
      if (fullText.includes("送车上门")) orderType = "DOOR_DELIVERY";
      else if (fullText.includes("商家上门取车")) orderType = "DOOR_PICKUP";
      else if (fullText.includes("到店还车")) orderType = "STORE_RETURN";
      else orderType = "STORE_PICKUP";
    }

    // ── 订单状态映射 ──
    const orderStatus =
      mapOrderStatusRaw(record.order_status_raw) ??
      mapOrderStatusRaw(record.order_status) ??
      "PENDING";

    // ── 城市校验 ──
    const city = record.city?.trim();
    if (city && !isValidPilotCity(city)) {
      return fail(`城市 "${city}" 不在试点范围内，首批仅支持：${PILOT_CITIES.join("、")}`, {
        status: 400, traceId
      });
    }
    const province = record.province?.trim() || null;
    const district = record.district?.trim() || null;

    // ── 日期解析 ──
    const scheduledAt = parseDate(record.pickup_time) ??
      parseDate(record.captured_at) ??
      new Date();

    // ── 地理编码（拼接省市+区县，非阻塞）──
    const pickupAddress = record.pickup_address || record.pickup_store;
    const returnAddress = record.return_address || record.return_store;
    const pickupGeoInput = buildGeocodeAddress(pickupAddress, { province, city, district });
    const returnGeoInput = buildGeocodeAddress(returnAddress, { province, city, district });
    const [pickupGeo, returnGeo] = await Promise.all([
      geocodeAddress(pickupGeoInput.fullAddress, "取车地址", pickupGeoInput.cityParam || undefined),
      geocodeAddress(returnGeoInput.fullAddress, "还车地址", returnGeoInput.cityParam || undefined),
    ]);

    const geocodePickupStatus = pickupGeo.success
      ? pickupGeo.geocodeStatus
      : (pickupGeo.geocodeStatus ?? "FAILED");
    const geocodeReturnStatus = returnGeo.success
      ? returnGeo.geocodeStatus
      : (returnGeo.geocodeStatus ?? "FAILED");

    // ── 字段映射 ──
    const order = await prisma.order.create({
      data: {
        orderNo: record.order_number,
        type: orderType,
        status: orderStatus,
        storeId: store.id,
        channel: record.order_source || "BROWSER_PLUGIN",
        driverNameSnapshot: record.driver_name || record.delivery_driver || null,
        vehicleTypeSnapshot: record.car_model || null,
        licensePlateSnapshot: record.license_plate || null,
        pickupAddress,
        pickupLat: pickupGeo.success ? pickupGeo.lat : null,
        pickupLng: pickupGeo.success ? pickupGeo.lng : null,
        returnAddress,
        returnLat: returnGeo.success ? returnGeo.lat : null,
        returnLng: returnGeo.success ? returnGeo.lng : null,
        scheduledAt,
        geocodePickupStatus,
        geocodeReturnStatus,
      },
    });

    log.info("插件入单成功", {
      traceId,
      orderNo: order.orderNo,
      orderType,
      orderStatus,
      storeCode,
      city: city ?? null,
      geocodePickupStatus,
      geocodeReturnStatus,
      driverName: record.driver_name,
      licensePlate: record.license_plate,
    });

    return ok(
      {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        type: orderType,
        driverName: record.driver_name,
        licensePlate: record.license_plate,
      },
      { traceId }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "入单失败";
    log.error("插件入单异常", { traceId, error: message });
    return fail(message, { status: 500, traceId });
  }
}

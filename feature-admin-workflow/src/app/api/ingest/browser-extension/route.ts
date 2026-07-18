import type { OrderType } from "@/types";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { geocodeAddress } from "@/lib/import/services/geocode";
import {
  buildGeocodeAddress,
  isValidCoordinate,
  mapOrderStatusRaw,
  mapOrderTypeRaw,
  validateRequiredCity,
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

/** 插件 POST 过来的原始 JSON 结构（兼容旧 snake_case + 推荐 camelCase DTO） */
interface ExtensionRecord {
  // 推荐 DTO（camelCase，优先使用）
  orderNo?: string;
  orderStatusRaw?: string;
  orderTypeRaw?: string;
  province?: string;
  city?: string;
  district?: string;
  source?: string;
  // 可选坐标（页面能拿到坐标则传）
  pickupLat?: number | null;
  pickupLng?: number | null;
  returnLat?: number | null;
  returnLng?: number | null;
  pickupAddress?: string;
  returnAddress?: string;
  scheduledAt?: string;
  driverName?: string;
  vehicleType?: string;
  licensePlate?: string;
  storeName?: string;
  capturedAt?: string;
  // 旧版 snake_case（兼容，逐步淘汰）
  order_number?: string;
  order_status_raw?: string;
  order_type_raw?: string;
  driver_name?: string;
  pickup_time?: string;
  delivery_driver?: string;
  return_time?: string;
  return_driver?: string;
  car_model?: string;
  license_plate?: string;
  pickup_store?: string;
  pickup_address?: string;
  return_store?: string;
  return_address?: string;
  order_source?: string;
  order_status?: string;
  captured_at?: string;
}

type IngestResult =
  | { success: true; orderNo: string; id: string; status: string; type: string }
  | { success: false; orderNo: string; reason: string; skipped?: boolean };

/** 单次请求最大记录数，防止无界批量耗尽数据库与地理编码配额 */
const MAX_BATCH_RECORDS = 200;

/** 请求体实际字节上限（1 MiB），流式累计校验，不信任 Content-Length */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * 流式读取请求体并累计字节数：一旦超过 maxBytes 立即取消读取并返回，
 * 避免把超大请求整体读进内存后再判断。
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; bytesRead: number }> {
  const body = request.body;
  if (!body) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return { ok: false, bytesRead };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

/** Prisma P2002 唯一约束冲突：findUnique 与 create 之间的并发窗口写入同一订单号 */
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** CORS 白名单：从 INGEST_ALLOWED_ORIGINS 读取（逗号分隔），未配置时拒绝所有跨域来源 */
function getAllowedOrigins(): string[] {
  return (process.env.INGEST_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * 解析请求 Origin 与白名单的匹配结果：
 * - 无 Origin 头（curl / 服务端调用）：非浏览器上下文，无需 CORS 头，放行
 * - Origin 在白名单：返回该 Origin 用于回显
 * - Origin 不在白名单：拒绝
 */
function resolveCorsOrigin(request: Request): { allowed: boolean; origin: string | null } {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, origin: null };
  return { allowed: getAllowedOrigins().includes(origin), origin };
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Key, Authorization, X-Trace-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(response: Response, origin: string | null) {
  for (const [key, value] of Object.entries(buildCorsHeaders(origin))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function OPTIONS(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const cors = resolveCorsOrigin(request);
  if (!cors.allowed) {
    return new Response(null, { status: 403, headers: { "X-Trace-Id": traceId } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...buildCorsHeaders(cors.origin),
      "X-Trace-Id": traceId,
    },
  });
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

async function ingestOne(record: ExtensionRecord, traceId: string): Promise<IngestResult> {
  try {
    // ── 字段读取（优先 camelCase DTO，回退 snake_case 兼容）──
    const orderNo = record.orderNo ?? record.order_number;
    const orderStatusRaw = record.orderStatusRaw ?? record.order_status_raw;
    const orderTypeRaw = record.orderTypeRaw ?? record.order_type_raw;
    const province = record.province?.trim() || null;
    const city = record.city?.trim();
    const district = record.district?.trim() || null;
    const pickupAddress = record.pickupAddress || record.pickup_address || record.pickup_store || "";
    const returnAddress = record.returnAddress || record.return_address || record.return_store || "";
    const source = record.source ?? record.order_source ?? "BROWSER_PLUGIN";

    // ── 必填字段校验 ──
    if (!orderNo) {
      return { success: false, orderNo: "", reason: "缺少必填字段: orderNo / order_number（订单号）" };
    }
    if (!pickupAddress) {
      return { success: false, orderNo, reason: "缺少取车地址" };
    }
    if (!returnAddress) {
      return { success: false, orderNo, reason: "缺少还车地址" };
    }

    // ── 去重（数据库已存在 → 计入 skipped，不算失败）──
    const existing = await prisma.order.findFirst({
      where: { orderNo },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      return { success: false, orderNo, reason: `订单 ${orderNo} 已存在，跳过`, skipped: true };
    }

    // ── 门店查找 ──
    const storeName = record.storeName || record.pickup_store || record.return_store || "";
    const storeCode = await resolveStoreCode(storeName);
    if (!storeCode) {
      return { success: false, orderNo, reason: `无法匹配门店: ${storeName}，请先在系统中创建对应门店` };
    }

    const store = await prisma.store.findUnique({ where: { code: storeCode } });
    if (!store) {
      return { success: false, orderNo, reason: `门店不存在: ${storeCode}` };
    }

    // ── 城市必填校验 ──
    const cityCheck = validateRequiredCity(city);
    if (!cityCheck.valid) {
      return { success: false, orderNo, reason: cityCheck.error };
    }
    const cityValidated = cityCheck.city;

    // ── 订单类型映射（只从 orderTypeRaw 映射，不误用状态字段）──
    let orderType: OrderType;
    const mappedType = mapOrderTypeRaw(orderTypeRaw);
    if (mappedType) {
      orderType = mappedType;
    } else {
      // 回退：从地址文本推断
      const fullText = `${pickupAddress} ${returnAddress}`;
      if (fullText.includes("送车上门")) orderType = "DOOR_DELIVERY";
      else if (fullText.includes("商家上门取车")) orderType = "DOOR_PICKUP";
      else if (fullText.includes("到店还车")) orderType = "STORE_RETURN";
      else orderType = "STORE_PICKUP";
    }

    // ── 订单状态映射（只从 orderStatusRaw 映射）──
    const orderStatus = mapOrderStatusRaw(orderStatusRaw) ?? "PENDING";

    // ── 日期解析 ──
    const scheduledAt = parseDate(record.scheduledAt ?? "") ??
      parseDate(record.pickup_time ?? "") ??
      parseDate(record.capturedAt ?? "") ??
      parseDate(record.captured_at ?? "") ??
      new Date();

    // ── 坐标取值优先级：页面显式传入(需通过校验) > 地理编码回退 ──
    const hasExplicitPickup = isValidCoordinate(record.pickupLat, record.pickupLng);
    const hasExplicitReturn = isValidCoordinate(record.returnLat, record.returnLng);

    const pickupGeoInput = buildGeocodeAddress(pickupAddress, { province, city: cityValidated, district });
    const returnGeoInput = buildGeocodeAddress(returnAddress, { province, city: cityValidated, district });
    const [pickupGeo, returnGeo] = await Promise.all([
      hasExplicitPickup
        ? null
        : geocodeAddress(pickupGeoInput.fullAddress, "取车地址", pickupGeoInput.cityParam || undefined),
      hasExplicitReturn
        ? null
        : geocodeAddress(returnGeoInput.fullAddress, "还车地址", returnGeoInput.cityParam || undefined),
    ]);

    // 显式坐标通过 isValidCoordinate 校验后才使用 FROM_SOURCE，否则从 geocode 取值
    const pickupLat = hasExplicitPickup ? Number(record.pickupLat) : (pickupGeo?.success ? pickupGeo.lat : null);
    const pickupLng = hasExplicitPickup ? Number(record.pickupLng) : (pickupGeo?.success ? pickupGeo.lng : null);
    const returnLat = hasExplicitReturn ? Number(record.returnLat) : (returnGeo?.success ? returnGeo.lat : null);
    const returnLng = hasExplicitReturn ? Number(record.returnLng) : (returnGeo?.success ? returnGeo.lng : null);

    const geocodePickupStatus = hasExplicitPickup
      ? "FROM_SOURCE"
      : (pickupGeo?.geocodeStatus ?? "FAILED");
    const geocodeReturnStatus = hasExplicitReturn
      ? "FROM_SOURCE"
      : (returnGeo?.geocodeStatus ?? "FAILED");

    // ── 写入 RDS（并发下同一订单号可能穿过 findUnique 检查，P2002 视为重复 → skipped）──
    let order;
    try {
      order = await prisma.order.create({
        data: {
          orderNo,
          type: orderType,
          status: orderStatus,
          storeId: store.id,
          channel: source,
          driverNameSnapshot: record.driverName || record.driver_name || record.delivery_driver || null,
          vehicleTypeSnapshot: record.vehicleType || record.car_model || null,
          licensePlateSnapshot: record.licensePlate || record.license_plate || null,
          pickupAddress,
          pickupLat,
          pickupLng,
          returnAddress,
          returnLat,
          returnLng,
          scheduledAt,
          geocodePickupStatus,
          geocodeReturnStatus,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        log.warn("插件入单并发重复", { traceId, orderNo });
        return { success: false, orderNo, reason: `订单 ${orderNo} 已存在（并发写入），跳过`, skipped: true };
      }
      throw error;
    }

    log.info("插件入单成功", {
      traceId,
      orderNo: order.orderNo,
      orderType,
      orderStatus,
      storeCode,
      city: cityValidated,
      geocodePickupStatus,
      geocodeReturnStatus,
      driverName: record.driverName || record.driver_name,
      licensePlate: record.licensePlate || record.license_plate,
    });

    return { success: true, id: order.id, orderNo: order.orderNo, status: order.status, type: orderType };
  } catch (error) {
    const message = error instanceof Error ? error.message : "入单失败";
    log.error("插件入单异常", { traceId, error: message });
    return { success: false, orderNo: record.orderNo ?? record.order_number ?? "", reason: message };
  }
}

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // ── CORS 白名单校验：Origin 存在但不在白名单 → 403 ──
  const cors = resolveCorsOrigin(request);
  if (!cors.allowed) {
    log.warn("插件入单被拒绝：Origin 不在白名单", { traceId, origin: cors.origin });
    return fail("来源不被允许", { status: 403, traceId });
  }

  // 轻量鉴权（支持两种格式：X-Ingest-Key 和 Authorization: Bearer）
  const ingestKey =
    request.headers.get("X-Ingest-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!ingestKey || ingestKey !== process.env.INGEST_API_KEY) {
    return withCors(fail("无效的 Ingest Key", { status: 401, traceId }), cors.origin);
  }

  try {
    // ── 请求体流式大小限制：超过上限立即取消读取，不整体载入内存 ──
    const bodyRead = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      log.warn("插件入单被拒绝：请求体超限", { traceId, bytesRead: bodyRead.bytesRead, limit: MAX_BODY_BYTES });
      return withCors(
        fail(`请求体过大（已读取 ${bodyRead.bytesRead} 字节即超限），上限 ${MAX_BODY_BYTES} 字节`, { status: 413, traceId }),
        cors.origin
      );
    }

    const body = JSON.parse(bodyRead.text);
    const records = Array.isArray(body) ? body as ExtensionRecord[] : [body as ExtensionRecord];

    if (records.length === 0) {
      return withCors(fail("请求体为空，未收到订单数据", { status: 400, traceId }), cors.origin);
    }

    // ── 批次上限 ──
    if (records.length > MAX_BATCH_RECORDS) {
      log.warn("插件入单被拒绝：批次超限", { traceId, count: records.length, limit: MAX_BATCH_RECORDS });
      return withCors(
        fail(`单次最多 ${MAX_BATCH_RECORDS} 条订单，当前 ${records.length} 条，请分批提交`, { status: 413, traceId }),
        cors.origin
      );
    }

    // ── 批次内去重：同一订单号在本批出现多次时，后续记录计入 skipped ──
    const seenInBatch = new Set<string>();
    const results: IngestResult[] = [];
    for (const record of records) {
      const orderNo = record.orderNo ?? record.order_number;
      if (orderNo && seenInBatch.has(orderNo)) {
        results.push({ success: false, orderNo, reason: `订单 ${orderNo} 在本批次中重复，跳过`, skipped: true });
        continue;
      }
      if (orderNo) seenInBatch.add(orderNo);
      results.push(await ingestOne(record, traceId));
    }

    const successCount = results.filter((r) => r.success).length;
    const skippedCount = results.filter((r) => !r.success && r.skipped).length;
    const failed = results.length - successCount - skippedCount;

    return withCors(ok({
      total: results.length,
      success: successCount,
      skipped: skippedCount,
      failed,
      results,
    }, { traceId }), cors.origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "入单失败";
    log.error("插件入单请求异常", { traceId, error: message });
    return withCors(fail(message, { status: 500, traceId }), cors.origin);
  }
}

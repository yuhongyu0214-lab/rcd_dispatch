import type { OrderStatus, OrderType } from "@/types";

// ============================================================================
// 城市字典（首批：杭州市试点）
// ============================================================================

/** 首批支持的城市列表（杭州市试点（浙江省，amapCity="杭州"）） */
export const PILOT_CITIES = ["杭州市"] as const;

export type PilotCity = (typeof PILOT_CITIES)[number];

/** 校验城市是否在试点范围内（city 为空或不在列表中均返回 false） */
export function isValidPilotCity(city: string | null | undefined): city is PilotCity {
  if (!city) return false;
  return PILOT_CITIES.includes(city.trim() as PilotCity);
}

/** 校验 city 是否合法试点城市，不合法返回 400 错误信息 */
export function validateRequiredCity(
  city: string | null | undefined
): { valid: true; city: string } | { valid: false; error: string } {
  const trimmed = city?.trim() ?? "";
  if (!trimmed) {
    return { valid: false, error: "缺少必填字段 city（城市），请提供试点城市" };
  }
  if (!isValidPilotCity(trimmed)) {
    return { valid: false, error: `城市 "${trimmed}" 不在试点范围内，首批仅支持：${PILOT_CITIES.join("、")}` };
  }
  return { valid: true, city: trimmed };
}

// ============================================================================
// 外部订单状态 → 系统枚举映射
// ============================================================================

const ORDER_STATUS_RAW_MAP: Record<string, OrderStatus> = {
  "待取车": "PENDING",
  "待送车": "PENDING",
  "待派单": "PENDING",
  "已派单": "ASSIGNED",
  "司机已接单": "ACCEPTED",
  "服务中": "IN_PROGRESS",
  "进行中": "IN_PROGRESS",
  "待还车": "IN_PROGRESS",
  "已完成": "COMPLETED",
  "已取消": "CANCELLED",
};

/**
 * 将外部原始订单状态映射为系统 OrderStatus 枚举。
 * 无法识别时返回 null，由调用方决定回退策略。
 */
export function mapOrderStatusRaw(raw: string | null | undefined): OrderStatus | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return ORDER_STATUS_RAW_MAP[trimmed] ?? null;
}

// ============================================================================
// 外部订单类型 → 系统枚举映射
// ============================================================================

const ORDER_TYPE_RAW_MAP: Record<string, OrderType> = {
  "到店取车": "STORE_PICKUP",
  "门店取车": "STORE_PICKUP",
  "送车上门": "DOOR_DELIVERY",
  "到店还车": "STORE_RETURN",
  "门店还车": "STORE_RETURN",
  "商家上门取车": "DOOR_PICKUP",
  "上门取车": "DOOR_PICKUP",
};

/**
 * 将外部原始订单类型映射为系统 OrderType 枚举。
 * 无法识别时返回 null。
 */
export function mapOrderTypeRaw(raw: string | null | undefined): OrderType | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return ORDER_TYPE_RAW_MAP[trimmed] ?? null;
}

// ============================================================================
// Geocode 地址拼接
// ============================================================================

/**
 * 逐段去重拼接：省 + 市 + 区 + 地址。
 * 地址已包含某段时跳过该段，缺哪段补哪段，不因包含城市名就提前返回导致丢失区县。
 */
export function buildGeocodeAddress(
  address: string,
  context?: {
    province?: string | null;
    city?: string | null;
    district?: string | null;
  }
): { fullAddress: string; cityParam: string } {
  const provinceName = context?.province?.trim() ?? "";
  const cityName = context?.city?.trim() ?? "";
  const districtName = context?.district?.trim() ?? "";

  // 逐段检查：地址未包含该段时才拼接（避免重复拼接，同时不丢失信息）
  const prefix: string[] = [];
  if (provinceName && !address.includes(provinceName)) prefix.push(provinceName);
  if (cityName && !address.includes(cityName)) prefix.push(cityName);
  if (districtName && !address.includes(districtName)) prefix.push(districtName);

  const fullAddress = prefix.length > 0 ? `${prefix.join("")}${address}` : address;
  return { fullAddress, cityParam: cityName };
}

// ============================================================================
// Geocode 状态枚举（写入 order.geocodePickupStatus / geocodeReturnStatus）
// ============================================================================

export type GeocodeIngestStatus =
  | "SUCCESS"
  | "FAILED"
  | "CITY_MISMATCH"
  | "MISSING_CITY"
  | "FROM_SOURCE";

// ============================================================================
// 坐标运行时校验
// ============================================================================

/** GCJ02 中国境内合法坐标范围 */
const GCJ02_BOUNDS = {
  latMin: 18,
  latMax: 54,
  lngMin: 73,
  lngMax: 136,
} as const;

/**
 * 校验坐标是否为有效 GCJ02 数值（有限数字 + 中国境内范围）。
 * 返回 true 表示坐标合法可直写 RDS。
 */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null) return false;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  return (
    latNum >= GCJ02_BOUNDS.latMin &&
    latNum <= GCJ02_BOUNDS.latMax &&
    lngNum >= GCJ02_BOUNDS.lngMin &&
    lngNum <= GCJ02_BOUNDS.lngMax
  );
}

// ============================================================================
// 可见订单状态（地图看板 + 订单列表共用）
// ============================================================================

/** 地图看板和订单列表中应展示的订单状态 */
export const VISIBLE_ORDER_STATUSES = [
  "PENDING", "RECOMMENDING", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"
] as const;

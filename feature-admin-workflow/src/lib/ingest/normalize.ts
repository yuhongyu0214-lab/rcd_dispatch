import type { OrderStatus, OrderType } from "@/types";

// ============================================================================
// 城市字典（首批：南昌市试点）
// ============================================================================

/** 首批支持的城市列表 */
export const PILOT_CITIES = ["南昌市"] as const;

export type PilotCity = (typeof PILOT_CITIES)[number];

/** 校验城市是否在试点范围内 */
export function isValidPilotCity(city: string): city is PilotCity {
  return PILOT_CITIES.includes(city as PilotCity);
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
 * 拼接 province + city + district + address 用于地理编码，提高短地址命中率。
 * 如果地址已包含城市名或区县名，避免重复拼接。
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

  // 地址已包含城市名，不重复拼接
  if (cityName && address.includes(cityName)) {
    return { fullAddress: address, cityParam: cityName };
  }

  // 拼接：省 + 城市 + 区县 + 地址（防同名地址误识别）
  const parts = [provinceName, cityName, districtName, address].filter(Boolean);
  return { fullAddress: parts.join(""), cityParam: cityName };
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

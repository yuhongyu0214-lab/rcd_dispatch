/**
 * 哈啰外部字段 → 内部 DTO 映射器。
 *
 * 所有字段转换集中在本文件，业务代码只引用 ExternalOrderDTO，
 * 不直接使用哈啰的 snake_case 字段名。
 *
 * ⚠️ 真实接入时只需修改本文件和 mock.ts，index.ts 接口不变。
 */

import type { ExternalOrderDTO } from "../types";
import type { HaluoRawOrder } from "./types";

/** 哈啰订单类型 → 系统 OrderType */
function mapHaluoOrderType(rawType: number): ExternalOrderDTO["orderType"] {
  const map: Record<number, ExternalOrderDTO["orderType"]> = {
    1: "STORE_PICKUP",
    2: "STORE_RETURN",
    3: "DOOR_DELIVERY",
    4: "DOOR_PICKUP"
  };
  return map[rawType] ?? "STORE_PICKUP";
}

/** Unix 时间戳 → ISO 8601 */
function mapTimestampToISO(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * 将哈啰原始订单映射为内部 DTO。
 *
 * @param raw — 哈啰 API 返回的原始订单对象
 * @returns 系统统一的 ExternalOrderDTO
 */
export function mapHaluoOrderToDTO(raw: HaluoRawOrder): ExternalOrderDTO {
  return {
    externalOrderId: raw.order_id,
    platform: "haluo",
    orderType: mapHaluoOrderType(raw.order_type),
    storeCode: raw.store_code,
    pickupAddress: raw.pickup_addr,
    returnAddress: raw.return_addr,
    pickupContactName: raw.contact_name,
    pickupContactPhone: raw.contact_phone,
    scheduledAt: mapTimestampToISO(raw.scheduled_timestamp),
    vehiclePlate: raw.plate_number || null,
    vehicleType: raw.car_model || null,
    rawPayload: raw as unknown as Record<string, unknown>
  };
}

/**
 * 批量映射。
 *
 * @param rawOrders — 哈啰 API 返回的原始订单数组
 * @returns 系统统一的 ExternalOrderDTO 数组
 */
export function mapHaluoOrdersToDTO(rawOrders: HaluoRawOrder[]): ExternalOrderDTO[] {
  return rawOrders.map(mapHaluoOrderToDTO);
}

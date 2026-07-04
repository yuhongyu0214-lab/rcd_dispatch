/**
 * 哈啰订单适配器入口
 *
 * V1: Mock 实现 → V2: 生产级映射 + 校验
 * ADAPTER_VERSION: "2.0.0"
 */

import type { OrderDTO } from "../types";
import {
  mapHaluoOrderToOrderDTO,
  mapHaluoOrderToOrderDTOSafe,
  mapHaluoOrdersToOrderDTOs,
  validateHaluoOrder
} from "./mapper";
import type { HaluoOrderPayload } from "./types";

// Mock 数据（真实接入时替换）
const MOCK_HALUO_ORDERS: HaluoOrderPayload[] = [
  {
    order_id: "haluo-20260628-001",
    order_no: "HL-20260628-001",
    biz_type: "store_pickup",
    store_code: "SH-HQ",
    store_name: "上海虹桥门店",
    car_plate: "沪A73K21",
    car_model: "别克 GL8",
    pickup_address: "上海虹桥T2停车楼",
    pickup_lat: 31.1942,
    pickup_lng: 121.3268,
    return_address: "静安嘉里中心",
    return_lat: 31.2264,
    return_lng: 121.4592,
    appointment_time: "2026-06-28T10:00:00.000+08:00"
  },
  {
    order_id: "haluo-20260628-002",
    order_no: "HL-20260628-002",
    biz_type: "door_pickup",
    store_code: "SH-PD",
    store_name: "浦东张江门店",
    car_plate: "沪D62Q19",
    car_model: "丰田 凯美瑞",
    pickup_address: "张江高科地铁站",
    pickup_lat: 31.2078,
    pickup_lng: 121.5991,
    return_address: "浦东机场T2",
    return_lat: 31.1503,
    return_lng: 121.8031,
    appointment_time: "2026-06-28T13:00:00.000+08:00"
  }
];

/** Adapter 版本号，用于字段变更追溯（文档 8.1 节） */
export const ADAPTER_VERSION = "2.0.0";

/**
 * Mock 哈啰订单拉取接口。
 * 真实接入时替换此实现，保持返回 OrderDTO[] 契约不变。
 * 使用安全映射函数（带校验），校验失败的订单会被过滤掉。
 */
export async function fetchOrders(): Promise<OrderDTO[]> {
  const result = mapHaluoOrdersToOrderDTOs(MOCK_HALUO_ORDERS);
  return result.orders;
}

// 映射函数
export { mapHaluoOrderToOrderDTO, mapHaluoOrderToOrderDTOSafe, mapHaluoOrdersToOrderDTOs, validateHaluoOrder };

// 类型导出
export type { HaluoOrderPayload };
export type { HaluoMappingError, BatchMappingResult } from "./mapper";

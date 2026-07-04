/**
 * 哈啰平台适配器 — 统一入口。
 *
 * 使用方式：
 *   import { fetchHaluoOrders } from "@/lib/adapters/haluo";
 *   const result = await fetchHaluoOrders("SH001");
 *
 * ⚠️ V1 Mock 实现，真实接入时内部实现替换，对外接口不变。
 */

export { fetchOrders as fetchHaluoOrders } from "./mock";
export { mapHaluoOrderToDTO, mapHaluoOrdersToDTO } from "./mapper";
export type { HaluoRawOrder, HaluoFetchOrdersResponse } from "./types";

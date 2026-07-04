/**
 * GPS 厂商适配器 — 统一入口。
 *
 * 使用方式：
 *   import { fetchVehicleGPSLocation } from "@/lib/adapters/gps";
 *   const result = await fetchVehicleGPSLocation("沪A12345");
 *
 * ⚠️ V1 Mock 实现，真实接入时内部实现替换，对外接口不变。
 */

export { fetchVehicleLocation as fetchVehicleGPSLocation } from "./mock";
export { mapGPSLocationToDTO } from "./mapper";
export type { GPSRawVehicleLocation } from "./types";

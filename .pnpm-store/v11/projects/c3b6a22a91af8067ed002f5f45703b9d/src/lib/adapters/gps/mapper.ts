/**
 * GPS 外部字段 → 内部 DTO 映射器。
 *
 * 所有字段转换集中在本文件，业务代码只引用 VehicleLocationDTO，
 * 不直接使用 GPS 厂商的字段名。
 *
 * ⚠️ 真实接入时只需修改本文件和 mock.ts，index.ts 接口不变。
 */

import type { VehicleLocationDTO } from "../types";
import type { GPSRawVehicleLocation } from "./types";

/**
 * 将 GPS 厂商原始位置数据映射为内部 DTO。
 *
 * @param raw — GPS 厂商 API 返回的原始位置数据
 * @returns 系统统一的 VehicleLocationDTO
 */
export function mapGPSLocationToDTO(raw: GPSRawVehicleLocation): VehicleLocationDTO {
  return {
    vehiclePlate: raw.plate,
    lat: raw.lat,
    lng: raw.lng,
    speed: raw.speed ?? null,
    heading: raw.direction ?? null,
    updatedAt: new Date(raw.gps_time * 1000).toISOString()
  };
}

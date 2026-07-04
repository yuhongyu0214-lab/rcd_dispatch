/**
 * GPS 适配器 Mock 实现。
 *
 * 模拟 GPS 厂商终端查询接口，返回固定样本数据。
 * 模拟网络延迟 100–300ms，模拟 3% 概率返回设备离线。
 *
 * ⚠️ 真实接入时：
 *   1. 将 fetchVehicleLocation() 中的 mock 逻辑替换为 HTTP 调用 GPS 厂商 API
 *   2. 保持函数签名不变（入参/返回值类型不变）
 *   3. 替换位置标注了 "@replace" 注释
 */

import type { AdapterResult, VehicleLocationDTO } from "../types";
import { mapGPSLocationToDTO } from "./mapper";
import type { GPSRawVehicleLocation } from "./types";

// ---------------------------------------------------------------------------
// Mock 数据
// ---------------------------------------------------------------------------

const MOCK_VEHICLE_LOCATIONS: Record<string, GPSRawVehicleLocation> = {
  // 默认 Mock 车辆 — 两部车在上海浦东
  default: {
    imei: "860123456789012",
    plate: "沪A12345",
    lng: 121.5897,
    lat: 31.2082,
    speed: 42,
    direction: 180,
    gps_time: Math.floor(Date.now() / 1000) - 30,
    report_time: new Date().toISOString()
  }
};

// ---------------------------------------------------------------------------
// Mock 工具
// ---------------------------------------------------------------------------

function randomDelay(): Promise<void> {
  const ms = 100 + Math.random() * 200;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldSimulateOffline(): boolean {
  return Math.random() < 0.03;
}

/**
 * 根据车牌号查询车辆最新 GPS 位置。
 *
 * V1 Mock：返回上海浦东固定坐标，模拟行驶中的车辆。
 * 真实接入时替换为 GPS 厂商 HTTP 调用。
 *
 * @param vehicleId — 车牌号
 * @returns AdapterResult<VehicleLocationDTO>
 *
 * @replace 真实接入：将本函数体替换为 fetch(GPS_API_URL, { params: { plate: vehicleId } })
 */
export async function fetchVehicleLocation(
  vehicleId: string
): Promise<AdapterResult<VehicleLocationDTO>> {
  // @replace: 模拟网络延迟，真实接入时删除此行
  await randomDelay();

  // @replace: 模拟 3% 概率设备离线，真实接入时替换为 HTTP 响应状态判断
  if (shouldSimulateOffline()) {
    return {
      success: false,
      error: `车辆 ${vehicleId} GPS 设备离线，无最新位置数据（Mock 模拟离线）`
    };
  }

  // @replace: 模拟响应，真实接入时替换为 HTTP 响应解包
  // 用 plate 匹配 mock 数据，未匹配到时生成随机偏移坐标
  const baseLocation = MOCK_VEHICLE_LOCATIONS[vehicleId] ?? MOCK_VEHICLE_LOCATIONS.default;
  const raw: GPSRawVehicleLocation = {
    ...baseLocation,
    plate: vehicleId,
    // 每次查询微调坐标，模拟车辆移动
    lng: baseLocation.lng + (Math.random() - 0.5) * 0.002,
    lat: baseLocation.lat + (Math.random() - 0.5) * 0.002,
    speed: Math.max(0, baseLocation.speed + (Math.random() - 0.5) * 20),
    direction: Math.floor(Math.random() * 360),
    gps_time: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 60),
    report_time: new Date().toISOString()
  };

  // @replace: 以下映射逻辑在真实接入时保持不变
  const dto = mapGPSLocationToDTO(raw);
  return { success: true, data: dto };
}

import { mapGpsVehicleLocationToDTO } from "./mapper";
import type { GpsVehicleLocationPayload } from "./types";

const MOCK_GPS_LOCATIONS: Record<string, GpsVehicleLocationPayload> = {
  "vehicle-sh-hq-001": {
    vehicle_id: "vehicle-sh-hq-001",
    device_id: "gps-mock-001",
    plate_no: "沪A73K21",
    latitude: 31.1942,
    longitude: 121.3268,
    gps_time: "2026-06-28T09:42:00.000+08:00"
  },
  "vehicle-sh-pd-001": {
    vehicle_id: "vehicle-sh-pd-001",
    device_id: "gps-mock-002",
    plate_no: "沪D62Q19",
    latitude: 31.2078,
    longitude: 121.5991,
    gps_time: "2026-06-28T09:40:00.000+08:00"
  }
};

/**
 * Mock GPS 车辆位置接口。真实接入时替换此实现，保持 lat/lng/updatedAt 返回契约不变。
 */
export async function fetchVehicleLocation(
  vehicleId: string
): Promise<{ lat: number; lng: number; updatedAt: string }> {
  const payload = MOCK_GPS_LOCATIONS[vehicleId] ?? {
    vehicle_id: vehicleId,
    device_id: "gps-mock-fallback",
    plate_no: "",
    latitude: 31.2304,
    longitude: 121.4737,
    gps_time: new Date("2026-06-28T09:45:00.000+08:00").toISOString()
  };
  const dto = mapGpsVehicleLocationToDTO(payload);

  return {
    lat: dto.coordinate.lat,
    lng: dto.coordinate.lng,
    updatedAt: dto.updatedAt
  };
}

export { mapGpsVehicleLocationToDTO };
export type { GpsVehicleLocationPayload };

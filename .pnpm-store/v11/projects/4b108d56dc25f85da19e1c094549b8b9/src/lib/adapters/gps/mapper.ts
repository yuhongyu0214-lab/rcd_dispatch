import type { VehicleLocationDTO } from "../types";
import type { GpsVehicleLocationPayload } from "./types";

export function mapGpsVehicleLocationToDTO(
  payload: GpsVehicleLocationPayload
): VehicleLocationDTO {
  return {
    vehicleId: payload.vehicle_id,
    coordinate: {
      lat: payload.latitude,
      lng: payload.longitude
    },
    updatedAt: payload.gps_time,
    source: "GPS_MOCK"
  };
}

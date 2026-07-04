import type { OrderStatus, OrderType, VehicleStatus } from "@prisma/client";

export type AdapterSource = "HALUO_MOCK" | "HALUO" | "GPS_MOCK" | "GPS";

export type AdapterCoordinate = {
  lat: number;
  lng: number;
};

export type OrderDTO = {
  externalOrderId: string;
  orderNo: string;
  type: OrderType;
  status: OrderStatus;
  storeCode: string;
  storeName: string;
  licensePlateSnapshot: string | null;
  vehicleTypeSnapshot: string | null;
  pickupAddress: string;
  pickupCoordinate: AdapterCoordinate | null;
  returnAddress: string;
  returnCoordinate: AdapterCoordinate | null;
  scheduledAt: string;
  channel: string;
  source: AdapterSource;
};

export type DriverLocationDTO = {
  driverId: string;
  coordinate: AdapterCoordinate;
  updatedAt: string;
  source: AdapterSource;
};

export type VehicleDTO = {
  externalVehicleId: string;
  licensePlate: string;
  vehicleType: string;
  status: VehicleStatus;
  storeCode: string;
  storeName: string;
  gpsCoordinate: AdapterCoordinate | null;
  gpsUpdatedAt: string | null;
  source: AdapterSource;
};

export type VehicleLocationDTO = {
  vehicleId: string;
  coordinate: AdapterCoordinate;
  updatedAt: string;
  source: AdapterSource;
};

import type { DriverStatus, OrderStatus, OrderType, VehicleStatus } from "@prisma/client";

import type { OrderDisplayDTO } from "./order-display-dto";

export type MapPointKind = "ORDER" | "DRIVER" | "VEHICLE" | "STORE";

export type MapCoordinateSource =
  | "ORDER"
  | "VEHICLE"
  | "STORE"
  | "MOCK"
  | "FALLBACK"
  | "REDIS"
  | "DRIVER";

export type MapCoordinate = {
  lat: number;
  lng: number;
  source: MapCoordinateSource;
};

export type MapOrderPoint = {
  kind: "ORDER";
  id: string;
  orderNo: string;
  type: OrderType;
  status: OrderStatus;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  storeName: string;
  vehicleLabel: string | null;
  coordinate: MapCoordinate;
  display?: OrderDisplayDTO;
};

export type MapDriverPoint = {
  kind: "DRIVER";
  id: string;
  name: string;
  phone: string;
  status: DriverStatus;
  storeName: string;
  coordinate: MapCoordinate;
  /** ISO 8601 timestamp of last known GPS position (from Redis `server_ts`). null if never reported. */
  lastSeenAt: string | null;
};

export type MapVehiclePoint = {
  kind: "VEHICLE";
  id: string;
  licensePlate: string;
  vehicleType: string;
  status: VehicleStatus;
  storeName: string;
  coordinate: MapCoordinate;
};

export type MapStorePoint = {
  kind: "STORE";
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  storeName: string;
  coordinate: MapCoordinate;
};

export type MapPoint = MapOrderPoint | MapDriverPoint | MapVehiclePoint | MapStorePoint;

export type MapBoardSummary = {
  orderCount: number;
  pendingOrderCount: number;
  driverCount: number;
  activeDriverCount: number;
  vehicleCount: number;
  availableVehicleCount: number;
  storeCount: number;
};

export type MapBoardPayload = {
  orders: MapOrderPoint[];
  drivers: MapDriverPoint[];
  vehicles: MapVehiclePoint[];
  stores: MapStorePoint[];
  summary: MapBoardSummary;
  /** 动态地图中心：从第一个有 GPS 的车辆计算，回退到 DEFAULT_MAP_CENTER */
  mapCenter: { lat: number; lng: number };
  generatedAt: string;
};

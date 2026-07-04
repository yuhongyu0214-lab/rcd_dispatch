import type { DriverStatus, OrderStatus, OrderType, VehicleStatus } from "@prisma/client";

import type { OrderDisplayDTO } from "./order-display-dto";

export type MapPointKind = "ORDER" | "DRIVER" | "VEHICLE" | "STORE";

export type MapCoordinateSource = "ORDER" | "VEHICLE" | "STORE" | "MOCK" | "FALLBACK";

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
  generatedAt: string;
};

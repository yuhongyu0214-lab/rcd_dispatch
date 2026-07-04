export const DRIVER_STATUSES = [
  "OFFLINE",
  "S1",
  "S2",
  "S3",
  "S4",
  "UNAVAILABLE"
] as const;

export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const VEHICLE_STATUSES = [
  "AVAILABLE",
  "PRE_ASSIGNED",
  "IN_USE",
  "UNAVAILABLE"
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export type DriverRecord = {
  id: string;
  storeId: string;
  name: string;
  phone: string;
  status: DriverStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DriverSummary = Pick<
  DriverRecord,
  "id" | "storeId" | "name" | "phone" | "status"
>;

export type VehicleRecord = {
  id: string;
  storeId: string;
  licensePlate: string;
  vehicleType: string;
  status: VehicleStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleSummary = Pick<
  VehicleRecord,
  "id" | "storeId" | "licensePlate" | "vehicleType" | "status"
>;

export type StoreRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

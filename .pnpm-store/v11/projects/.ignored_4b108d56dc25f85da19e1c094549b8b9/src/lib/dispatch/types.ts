import type { DriverStatus, OrderType } from "@prisma/client";

export type DispatchOutcome = "DISPATCHED" | "PENDING" | "MANUAL";
export type DispatchPendingReason = "NO_DRIVER";
export type DispatchManualReason = "ETA_EXCEEDED";
export type DispatchReason = DispatchPendingReason | DispatchManualReason | null;

export type EtaStatus = "NORMAL" | "EXCEEDED" | "FALLBACK" | "FAILED";

export type DispatchCoordinate = {
  lat: number;
  lng: number;
};

export type DriverActiveOrderCounts = {
  store: number;
  door: number;
};

export type DispatchCandidate = {
  driverId: string;
  driverName: string;
  phone: string;
  driverStatus: DriverStatus;
  storeId: string;
  storeName: string;
  activeOrders: DriverActiveOrderCounts;
  origin: DispatchCoordinate | null;
  distanceKm: number;
};

export type EtaResult = {
  driverId: string;
  etaMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  etaStatus: EtaStatus;
};

export type RankedCandidate = {
  driverId: string;
  driverName: string;
  phone: string;
  driverStatus: DriverStatus;
  storeId: string;
  storeName: string;
  etaMinutes: number;
  etaStatus: EtaStatus;
  distanceKm: number;
  loadPenaltyMinutes: number;
  activeStoreOrders: number;
  activeDoorOrders: number;
  priorityRank: number;
  score: number;
  reasons: string[];
};

export type DispatchResult = {
  orderId: string;
  orderNo: string;
  orderType: OrderType;
  outcome: DispatchOutcome;
  reason: DispatchReason;
  topN: RankedCandidate[];
};

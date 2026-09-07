import type { IngestRecordV2 } from "@/types/v2";

import type { NormalizedRecord } from "./types";

function trimOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCoordinate(
  value: number | undefined | null
): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeRecord(record: IngestRecordV2): NormalizedRecord {
  const raw = record as unknown as Record<string, unknown>;

  const getString = (field: string): string | undefined => {
    const value = raw[field];
    if (typeof value === "string") return trimOrUndefined(value);
    return undefined;
  };

  const getNumber = (field: string): number | undefined => {
    const value = raw[field];
    if (value === null || value === undefined) return undefined;
    if (typeof value === "number") return normalizeCoordinate(value);
    return undefined;
  };

  return {
    externalOrderId: getString("externalOrderId") ?? "",
    sourceVersion: getString("sourceVersion") ?? "",
    sourceStatusRaw: getString("sourceStatusRaw") ?? "",
    orderNo: getString("orderNo") ?? "",
    businessType: getString("businessType") ?? "",
    promisedPickupAt: getString("promisedPickupAt") ?? "",
    pickupAddress: getString("pickupAddress") ?? "",
    pickupLat: getNumber("pickupLat"),
    pickupLng: getNumber("pickupLng"),
    deliveryAddress: getString("deliveryAddress") ?? "",
    deliveryLat: getNumber("deliveryLat"),
    deliveryLng: getNumber("deliveryLng"),
    storeCode: getString("storeCode") ?? "",
    storeName: getString("storeName"),
    city: getString("city"),
    district: getString("district"),
    licensePlateSnapshot: getString("licensePlateSnapshot"),
    vehicleTypeSnapshot: getString("vehicleTypeSnapshot"),
    remark: getString("remark"),
    cancelledAt: getString("cancelledAt")
  };
}

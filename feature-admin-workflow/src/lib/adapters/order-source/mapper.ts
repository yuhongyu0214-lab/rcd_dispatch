import type { CanonicalOrderV2, OnlineOrderSourceSystemV2 } from "@/types/v2";

import type { NormalizedRecord } from "./types";

export function mapToCanonical(
  record: NormalizedRecord,
  sourceSystem: OnlineOrderSourceSystemV2,
  receivedAt: string
): CanonicalOrderV2 {
  return {
    sourceSystem,
    externalOrderId: record.externalOrderId,
    sourceVersion: record.sourceVersion,
    sourceStatusRaw: record.sourceStatusRaw,
    orderNo: record.orderNo,
    businessType: record.businessType as CanonicalOrderV2["businessType"],
    promisedPickupAt: record.promisedPickupAt,
    receivedAt,
    pickupAddress: record.pickupAddress,
    pickupLat: record.pickupLat,
    pickupLng: record.pickupLng,
    deliveryAddress: record.deliveryAddress,
    deliveryLat: record.deliveryLat,
    deliveryLng: record.deliveryLng,
    storeCode: record.storeCode,
    storeName: record.storeName,
    city: record.city,
    district: record.district,
    licensePlateSnapshot: record.licensePlateSnapshot,
    vehicleTypeSnapshot: record.vehicleTypeSnapshot,
    remark: record.remark,
    cancelledAt: record.cancelledAt
  };
}

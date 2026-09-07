import type {
  BusinessTypeV2,
  GeoPointV2,
  IsoDateTimeStringV2,
  OrderFeasibilityV2,
  ServicePlanV2
} from "@/types/v2";

export type DriverOrderMarkerViewV2 = {
  orderId: string;
  orderNo: string;
  businessType: BusinessTypeV2;
  executionStatus: "UNASSIGNED";
  slot: "NONE";
  lockType: "NONE";
  feasibility: OrderFeasibilityV2;
  promisedPickupAt: IsoDateTimeStringV2;
  pickupPoint?: GeoPointV2;
  deliveryPoint?: GeoPointV2;
  pickupAddress?: string;
  deliveryAddress?: string;
};

export type DriverModuleUpdateDataV2 = {
  servicePlan: ServicePlanV2 | null;
  planVersion: number;
  replayed: boolean;
};

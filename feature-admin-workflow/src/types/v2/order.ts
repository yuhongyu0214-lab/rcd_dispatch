import type {
  BusinessTypeV2,
  ExecutionStatusV2,
  IsoDateTimeStringV2,
  OnlineOrderSourceSystemV2,
  OrderFeasibilityV2,
  OrderSourceSystemV2
} from "./domain";

export type CanonicalOrderV2 = {
  sourceSystem: OrderSourceSystemV2;
  externalOrderId: string;
  sourceVersion: string;
  sourceStatusRaw: string;
  orderNo: string;
  businessType: BusinessTypeV2;
  promisedPickupAt: IsoDateTimeStringV2;
  receivedAt: IsoDateTimeStringV2;
  pickupAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryAddress: string;
  deliveryLat?: number;
  deliveryLng?: number;
  storeCode: string;
  storeName?: string;
  city?: string;
  district?: string;
  licensePlateSnapshot?: string;
  vehicleTypeSnapshot?: string;
  remark?: string;
  cancelledAt?: IsoDateTimeStringV2;
};

export type IngestRecordV2 = Omit<
  CanonicalOrderV2,
  "sourceSystem" | "receivedAt"
>;

export type IngestEnvelopeV2 = {
  sourceSystem: OnlineOrderSourceSystemV2;
  records: IngestRecordV2[];
};

export type OrderV2 = {
  id: string;
  orderNo: string;
  sourceSystem: OrderSourceSystemV2;
  externalOrderId: string;
  sourceVersion: string;
  businessType: BusinessTypeV2;
  executionStatus: ExecutionStatusV2;
  feasibility: OrderFeasibilityV2;
  slackMinutes: number | null;
  promisedPickupAt: IsoDateTimeStringV2;
  receivedAt: IsoDateTimeStringV2;
  pickupAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryAddress: string;
  deliveryLat?: number;
  deliveryLng?: number;
  storeCode: string;
  storeName?: string;
  licensePlateSnapshot?: string;
  vehicleTypeSnapshot?: string;
  remark?: string;
  cancelledAt?: IsoDateTimeStringV2;
  currentAssignmentId?: string;
  createdAt: IsoDateTimeStringV2;
  updatedAt: IsoDateTimeStringV2;
};

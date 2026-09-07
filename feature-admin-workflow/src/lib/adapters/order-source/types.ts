import type {
  IngestRecordV2,
  OnlineOrderSourceSystemV2
} from "@/types/v2";

/** 批次处理限制 */
export const MAX_BATCH_RECORDS = 200;
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/** 字段校验结果 */
export type ValidationResult = {
  valid: boolean;
  errors: Record<string, string[]>;
};

/**
 * 规范化后的中间记录
 * 所有字符串已 trim，可选坐标已规范化或置为 undefined
 */
export type NormalizedRecord = {
  externalOrderId: string;
  sourceVersion: string;
  sourceStatusRaw: string;
  orderNo: string;
  businessType: string;
  promisedPickupAt: string;
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
  cancelledAt?: string;
};

/** 处理上下文 */
export type IngestContext = {
  traceId: string;
  serverTime: string;
  sourceSystem: OnlineOrderSourceSystemV2;
};

/** 单个记录处理结果（未设定 index，由上层组装） */
export type ProcessResult = {
  result: IngestRecordV2; // 会被填入批次的 IngestRecordResultV2 内部
};

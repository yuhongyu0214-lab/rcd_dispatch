import type { OrderType } from "@/types";

import type { IMPORT_SOURCE_TYPES } from "./constants";

export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export type ImportIssueSeverity = "ERROR" | "WARNING";

export type ImportIssueCode =
  | "FILE_EMPTY"
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "TEMPLATE_HEADERS_MISSING"
  | "ROW_LIMIT_EXCEEDED"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_ORDER_TYPE"
  | "INVALID_DATETIME"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_IN_DATABASE"
  | "STORE_NOT_FOUND"
  | "GEOCODE_FAILED"
  | "VEHICLE_TYPE_UNRECOGNIZED"
  | "VEHICLE_STORE_MISMATCH"
  | "AMAP_KEY_MISSING";

export type ImportIssue = {
  rowNumber: number;
  field: string;
  code: ImportIssueCode;
  message: string;
  severity: ImportIssueSeverity;
  orderId: string | null;
};

export type ImportFeedbackRow = {
  rowNumber: number;
  orderId: string | null;
  issues: ImportIssue[];
};

export type ImportRowInput = {
  rowNumber: number;
  orderId: string;
  orderType: string;
  storeId: string;
  vehicleType: string;
  licensePlate: string;
  channel: string;
  driverName: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
};

export type ImportPreparedRow = {
  rowNumber: number;
  orderId: string;
  orderType: OrderType;
  storeDbId: string;
  storeCode: string;
  vehicleId: string | null;
  licensePlate: string;
  channel: string;
  driverName: string;
  vehicleType: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  returnAddress: string;
  returnLat: number | null;
  returnLng: number | null;
  scheduledAt: Date;
  warnings: ImportIssue[];
};

export type ImportSummary = {
  batchId: string;
  importedAt: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  warningCount: number;
  failedRows: ImportFeedbackRow[];
  warningRows: ImportFeedbackRow[];
};

export type StoredImportMetadata = ImportSummary & {
  fileName: string;
  sourceType: ImportSourceType;
  successfulOrderNos: string[];
  traceId?: string;
};

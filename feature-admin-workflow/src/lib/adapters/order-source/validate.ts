import type { IngestRecordV2 } from "@/types/v2";
import { BUSINESS_TYPES_V2 } from "@/types/v2";
import {
  isLegalOnlineSourceVersion,
  V1_MIGRATION_SOURCE_VERSION
} from "@/lib/contracts/v2/source-version";

import type { ValidationResult } from "./types";

function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function getStringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];
  if (typeof value === "string") return value.trim();
  return undefined;
}

function getOptionalNumber(
  record: Record<string, unknown>,
  field: string
): number | null | undefined {
  const value = record[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  return undefined;
}

const ISO_8601_MSZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidIso8601MsZ(value: string): boolean {
  if (!ISO_8601_MSZ_PATTERN.test(value)) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed);
}

function isValidFiniteLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidFiniteLng(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function validateIngestRecord(
  record: IngestRecordV2,
  index: number
): ValidationResult {
  const errors: Record<string, string[]> = {};
  const raw = record as unknown as Record<string, unknown>;

  const fieldPrefix = `records[${index}]`;

  // ---- 必填字符串字段 ----
  const requiredStrings: Array<{ field: string; label: string }> = [
    { field: "externalOrderId", label: "externalOrderId" },
    { field: "sourceVersion", label: "sourceVersion" },
    { field: "sourceStatusRaw", label: "sourceStatusRaw" },
    { field: "orderNo", label: "orderNo" },
    { field: "businessType", label: "businessType" },
    { field: "promisedPickupAt", label: "promisedPickupAt" },
    { field: "pickupAddress", label: "pickupAddress" },
    { field: "deliveryAddress", label: "deliveryAddress" },
    { field: "storeCode", label: "storeCode" }
  ];

  for (const { field, label } of requiredStrings) {
    const value = getStringField(raw, field);
    if (!value) {
      errors[label] = errors[label] ?? [];
      errors[label].push(`${fieldPrefix}.${field} 是必填字段`);
    }
  }

  // ---- sourceVersion 特殊校验 ----
  if (getStringField(raw, "sourceVersion")) {
    const sv = getStringField(raw, "sourceVersion")!;
    // 在线入单禁止 v1-migration
    if (sv === V1_MIGRATION_SOURCE_VERSION) {
      errors["sourceVersion"] = errors["sourceVersion"] ?? [];
      errors["sourceVersion"].push(
        `${fieldPrefix}.sourceVersion 不能为 v1-migration（在线入单不允许）`
      );
    } else if (!isLegalOnlineSourceVersion(sv)) {
      errors["sourceVersion"] = errors["sourceVersion"] ?? [];
      errors["sourceVersion"].push(
        `${fieldPrefix}.sourceVersion 格式不合法（需要 ISO 8601 毫秒级 Z 时间戳或纯数字序号）`
      );
    }
  }

  // ---- businessType 枚举校验 ----
  const bt = getStringField(raw, "businessType");
  if (bt) {
    const validTypes = BUSINESS_TYPES_V2 as readonly string[];
    if (!validTypes.includes(bt)) {
      errors["businessType"] = errors["businessType"] ?? [];
      errors["businessType"].push(
        `${fieldPrefix}.businessType 不在允许范围内: ${BUSINESS_TYPES_V2.join(", ")}`
      );
    }
  }

  // ---- promisedPickupAt 日期格式 ----
  const ppa = getStringField(raw, "promisedPickupAt");
  if (ppa && !isValidIso8601MsZ(ppa)) {
    errors["promisedPickupAt"] = errors["promisedPickupAt"] ?? [];
    errors["promisedPickupAt"].push(
      `${fieldPrefix}.promisedPickupAt 需要 ISO 8601 毫秒级 Z 格式（如 2026-07-18T09:00:00.000Z）`
    );
  }

  // ---- cancelledAt 可选日期格式 ----
  const ca = getStringField(raw, "cancelledAt");
  if (ca && !isValidIso8601MsZ(ca)) {
    errors["cancelledAt"] = errors["cancelledAt"] ?? [];
    errors["cancelledAt"].push(
      `${fieldPrefix}.cancelledAt 需要 ISO 8601 毫秒级 Z 格式（如 2026-07-18T09:00:00.000Z）`
    );
  }

  // ---- 坐标校验：提供则必须成对且合法 ----
  const lat = getOptionalNumber(raw, "pickupLat");
  const lng = getOptionalNumber(raw, "pickupLng");
  if (isNotNullOrUndefined(lat) || isNotNullOrUndefined(lng)) {
    if (!isNotNullOrUndefined(lat) || !isNotNullOrUndefined(lng)) {
      errors["pickupLat/pickupLng"] = errors["pickupLat/pickupLng"] ?? [];
      errors["pickupLat/pickupLng"].push(
        `${fieldPrefix}.pickupLat 和 pickupLng 必须成对提供`
      );
    } else if (!isValidFiniteLat(lat) || !isValidFiniteLng(lng)) {
      errors["pickupLat/pickupLng"] = errors["pickupLat/pickupLng"] ?? [];
      errors["pickupLat/pickupLng"].push(
        `${fieldPrefix}.pickupLat 或 pickupLng 超出合法范围 (-90~90, -180~180)`
      );
    }
  }

  const dlat = getOptionalNumber(raw, "deliveryLat");
  const dlng = getOptionalNumber(raw, "deliveryLng");
  if (isNotNullOrUndefined(dlat) || isNotNullOrUndefined(dlng)) {
    if (!isNotNullOrUndefined(dlat) || !isNotNullOrUndefined(dlng)) {
      errors["deliveryLat/deliveryLng"] = errors["deliveryLat/deliveryLng"] ?? [];
      errors["deliveryLat/deliveryLng"].push(
        `${fieldPrefix}.deliveryLat 和 deliveryLng 必须成对提供`
      );
    } else if (!isValidFiniteLat(dlat) || !isValidFiniteLng(dlng)) {
      errors["deliveryLat/deliveryLng"] = errors["deliveryLat/deliveryLng"] ?? [];
      errors["deliveryLat/deliveryLng"].push(
        `${fieldPrefix}.deliveryLat 或 deliveryLng 超出合法范围 (-90~90, -180~180)`
      );
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

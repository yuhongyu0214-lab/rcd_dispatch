import type { IngestRecordV2, OnlineOrderSourceSystemV2 } from "@/types/v2";
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

/**
 * P1-4 返修: "已取消"来源状态按 sourceSystem 建立精确映射，不再共用全局词表。
 * 原因：同一个词在不同来源含义不同 —— 如 "CLOSED / 关闭" 在部分平台表示
 * 订单正常完结而非取消，全局词表会把完成单误判成取消。
 * 原则：
 * - 只收录该来源明确表示"取消/作废"的值（trim + 大写归一后精确匹配）；
 * - 歧义词（关闭 / CLOSED / CLOSE 等）一律不收录；
 * - 未收录的状态回退为"非取消"，此时取消语义只能来自显式 cancelledAt 字段。
 */
const CANCELLED_STATUS_BY_SOURCE: Record<
  OnlineOrderSourceSystemV2,
  ReadonlySet<string>
> = {
  // 哈啰：中文状态文案
  HALUO: new Set(["已取消", "取消", "用户取消", "商家取消", "已撤销", "撤销"]),
  // 浏览器插件抓取：页面文案中英混合
  PLUGIN: new Set([
    "已取消",
    "取消",
    "已撤销",
    "撤销",
    "CANCELLED",
    "CANCELED"
  ]),
  // 开放 API：英文枚举
  API: new Set(["CANCELLED", "CANCELED", "CANCEL", "VOID", "VOIDED"])
};

/**
 * P1-4: 判断来源原始状态在指定来源系统语义下是否表示"已取消"。
 * 命中且 payload 未显式提供 cancelledAt 时，映射阶段应将 cancelledAt 置为 receivedAt。
 */
export function isSourceStatusCancelled(
  sourceStatusRaw: string,
  sourceSystem: OnlineOrderSourceSystemV2
): boolean {
  const normalized = sourceStatusRaw.trim().toUpperCase();
  if (normalized.length === 0) return false;
  return CANCELLED_STATUS_BY_SOURCE[sourceSystem]?.has(normalized) ?? false;
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

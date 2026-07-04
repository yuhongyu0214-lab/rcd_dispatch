/**
 * 哈啰订单字段映射 — 生产级实现
 *
 * 基于 docs/production-field-mapping.md v1.0 的字段映射表。
 * 覆盖全部 15 个字段映射、枚举转换、必填校验、类型防御。
 *
 * 映射表参考：
 *   2.1 订单字段映射（15 字段）
 *   2.2 业务类型映射（biz_type → OrderType）
 *   2.3 必填校验规则
 *   6.1 订单类型枚举映射
 *   7.2 缺失字段处理策略（订单字段）
 *   7.4 数据类型不兼容时的处理
 */

import type { OrderType } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import type { AdapterCoordinate, OrderDTO } from "../types";
import type { HaluoOrderBizType, HaluoOrderPayload } from "./types";

const log = createLogger("haluo-mapper");

// ============================================================================
// 枚举映射 — 文档 2.2 节 / 6.1 节
// ============================================================================

/**
 * 哈啰业务类型 → 内部 OrderType 映射表。
 * 文档参考：production-field-mapping 2.2 节，行 86-96
 * 双向映射，外部值不在映射表中的订单直接拒绝。
 */
const HALUO_TYPE_MAP: Record<HaluoOrderBizType, OrderType> = {
  store_pickup: "STORE_PICKUP", // 门店取车
  store_return: "STORE_RETURN", // 门店还车
  door_delivery: "DOOR_DELIVERY", // 送车上门
  door_pickup: "DOOR_PICKUP" // 上门取车
};

// ============================================================================
// 错误类型 — 文档 2.3 节 / 7.2 节
// ============================================================================

/**
 * 字段映射错误类型。
 * 文档参考：production-field-mapping 2.3 必填校验规则、7.2 字段缺失降级策略
 */
export interface HaluoMappingError {
  /** 外部订单 ID（如果有） */
  externalOrderId?: string;
  /** 错误字段名 */
  field: string;
  /** 错误信息（中文），格式符合文档 2.3 节错误信息模板 */
  message: string;
  /** 错误级别：P0=拒绝入库，P1=使用默认值 */
  severity: "P0" | "P1";
}

// ============================================================================
// 工具函数 — 文档 7.4 节 数据类型不兼容处理
// ============================================================================

/**
 * 坐标构造。
 * 文档参考：production-field-mapping 2.1 节序号 10/12
 * 两个值均为 number 且为有限数时构造，否则返回 null。
 */
function toCoordinate(lat?: unknown, lng?: unknown): AdapterCoordinate | null {
  // 文档 7.4：期望 number，收到 string 时尝试 parseFloat
  const latNum = typeof lat === "number" ? lat : Number(lat);
  const lngNum = typeof lng === "number" ? lng : Number(lng);

  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return null;
  }

  // 文档 5.4 坐标有效性校验
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return null;
  }

  return { lat: latNum, lng: lngNum };
}

/**
 * 安全字符串转换。
 * 文档参考：production-field-mapping 7.4 节，期望 string 收到 number 时调用 toString()
 */
function safeString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    log.warn("Field type coercion: number to string", {
      value: String(value)
    });
    return String(value);
  }
  return undefined;
}

/**
 * 移除空字符串（视为缺失）。
 * 文档参考：production-field-mapping 2.1 节序号 7/8，空字符串/undefined → null
 */
function nullIfEmpty(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  if (value.trim() === "") return null;
  return value;
}

// ============================================================================
// 主映射函数 — 文档 2.1 节 15 字段映射表
// ============================================================================

/**
 * 将哈啰订单 JSON 映射为内部 OrderDTO。
 *
 * 覆盖文档 production-field-mapping 2.1 节全部 15 个字段：
 *   1. order_id        → externalOrderId    直接透传
 *   2. order_no        → orderNo            直接透传
 *   3. biz_type        → type              查 HALUO_TYPE_MAP 转换
 *   4. (none)          → status            固定 "PENDING"
 *   5. store_code      → storeCode          直接透传
 *   6. store_name      → storeName          直接透传
 *   7. car_plate       → licensePlateSnapshot  ?? null
 *   8. car_model       → vehicleTypeSnapshot   ?? null
 *   9. pickup_address  → pickupAddress      直接透传
 *  10. pickup_lat/lng  → pickupCoordinate   toCoordinate() 或 null
 *  11. return_address  → returnAddress      直接透传
 *  12. return_lat/lng  → returnCoordinate   toCoordinate() 或 null
 *  13. appointment_time → scheduledAt       直接透传
 *  14. (none)          → channel            固定 "HALUO"
 *  15. (none)          → source             固定 "HALUO_MOCK"
 *
 * 必填校验见 validateHaluoOrder() 函数。
 */
export function mapHaluoOrderToOrderDTO(
  payload: HaluoOrderPayload
): OrderDTO {
  // 序号 3：业务类型映射（文档 2.2 节）
  const orderType = HALUO_TYPE_MAP[payload.biz_type];

  // 序号 7/8：空字符串 → null（文档 2.1 节）
  // 防御性处理：car_plate 和 car_model 可能为 undefined（文档 7.4 节）
  const carPlate =
    payload.car_plate !== undefined
      ? nullIfEmpty(safeString(payload.car_plate) ?? payload.car_plate as string)
      : null;
  const carModel =
    payload.car_model !== undefined
      ? nullIfEmpty(safeString(payload.car_model) ?? payload.car_model as string)
      : null;

  return {
    // 序号 1
    externalOrderId: payload.order_id,
    // 序号 2
    orderNo: payload.order_no,
    // 序号 3
    type: orderType,
    // 序号 4
    status: "PENDING",
    // 序号 5
    storeCode: payload.store_code,
    // 序号 6
    storeName: payload.store_name,
    // 序号 7
    licensePlateSnapshot: carPlate,
    // 序号 8
    vehicleTypeSnapshot: carModel,
    // 序号 9
    pickupAddress: payload.pickup_address,
    // 序号 10：防御性处理 coordinate 可能为 string 类型（文档 7.4 节）
    pickupCoordinate: toCoordinate(payload.pickup_lat, payload.pickup_lng),
    // 序号 11
    returnAddress: payload.return_address,
    // 序号 12
    returnCoordinate: toCoordinate(payload.return_lat, payload.return_lng),
    // 序号 13
    scheduledAt: payload.appointment_time,
    // 序号 14
    channel: "HALUO",
    // 序号 15
    source: "HALUO_MOCK"
  };
}

// ============================================================================
// 校验函数 — 文档 2.3 节 必填校验规则
// ============================================================================

/**
 * 校验哈啰订单必填字段。
 *
 * 文档参考：production-field-mapping 2.3 必填校验规则
 *
 * 返回错误列表，空列表表示校验通过。
 * 校验项覆盖：
 *   - order_id 非空
 *   - order_no 非空
 *   - biz_type 必须在 HALUO_TYPE_MAP 中存在
 *   - store_code 非空
 *   - store_name 非空
 *   - pickup_address 非空
 *   - return_address 非空
 *   - appointment_time 非空且可解析
 */
export function validateHaluoOrder(
  payload: HaluoOrderPayload,
  traceId?: string
): HaluoMappingError[] {
  const errors: HaluoMappingError[] = [];
  const orderId = payload.order_id ?? "unknown";

  const addError = (field: string, message: string, severity: "P0" | "P1" = "P0") => {
    errors.push({
      externalOrderId: orderId,
      field,
      message,
      severity
    });
  };

  // 必填校验：order_id（文档 2.3 节）
  if (!payload.order_id || String(payload.order_id).trim() === "") {
    addError("order_id", "外部订单ID缺失");
  }

  // 必填校验：order_no（文档 2.3 节）
  if (!payload.order_no || String(payload.order_no).trim() === "") {
    addError("order_no", "订单号缺失");
  }

  // 必填校验：biz_type（文档 2.3 节）
  if (!payload.biz_type) {
    addError("biz_type", "订单业务类型缺失");
  } else if (!(payload.biz_type in HALUO_TYPE_MAP)) {
    addError(
      "biz_type",
      `不支持的订单类型: ${payload.biz_type}`
    );
  }

  // 必填校验：store_code（文档 2.3 节）
  if (
    payload.store_code === undefined ||
    payload.store_code === null ||
    String(payload.store_code).trim() === ""
  ) {
    addError("store_code", "门店编码缺失");
  }

  // 必填校验：store_name（文档 2.3 节）
  if (
    payload.store_name === undefined ||
    payload.store_name === null ||
    String(payload.store_name).trim() === ""
  ) {
    addError("store_name", "门店名称缺失");
  }

  // 必填校验：pickup_address（文档 2.3 节）
  if (
    payload.pickup_address === undefined ||
    payload.pickup_address === null ||
    String(payload.pickup_address).trim() === ""
  ) {
    addError("pickup_address", "取车地址缺失");
  }

  // 必填校验：return_address（文档 2.3 节）
  if (
    payload.return_address === undefined ||
    payload.return_address === null ||
    String(payload.return_address).trim() === ""
  ) {
    addError("return_address", "还车地址缺失");
  }

  // 必填校验：appointment_time（文档 2.3 节）
  if (
    payload.appointment_time === undefined ||
    payload.appointment_time === null ||
    String(payload.appointment_time).trim() === ""
  ) {
    addError("appointment_time", "预约时间缺失");
  } else {
    // 文档 7.4：期望 ISO 8601，尝试 new Date() 解析
    const parsed = new Date(payload.appointment_time);
    if (isNaN(parsed.getTime())) {
      addError(
        "appointment_time",
        `预约时间缺失或格式错误: ${payload.appointment_time}`
      );
    }
  }

  if (errors.length > 0) {
    log.warn("haluo order validation failed", {
      orderId,
      errorCount: String(errors.length),
      traceId: traceId ?? null
    });
  }

  return errors;
}

// ============================================================================
// 安全映射函数（带校验）— 文档 2.3 节 / 7.2 节
// ============================================================================

/**
 * 安全映射：先校验再映射，有 P0 错误时抛异常。
 *
 * 文档参考：production-field-mapping 7.2/7.3 节缺失字段处理策略
 * - P0 错误：拒绝入库，抛异常（含 traceId）
 * - P1/P3 错误：不阻断，记录 warn 后继续
 *
 * 抛出错误时包含 traceId 用于全链路追踪。
 */
export function mapHaluoOrderToOrderDTOSafe(
  payload: HaluoOrderPayload,
  traceId?: string
): OrderDTO {
  const errors = validateHaluoOrder(payload, traceId);

  // P0 错误：拒绝入库（文档 7.2 节）
  const fatalErrors = errors.filter((e) => e.severity === "P0");
  if (fatalErrors.length > 0) {
    const messages = fatalErrors.map((e) => `${e.field}: ${e.message}`).join("; ");
    const error = new Error(`哈啰订单映射失败: ${messages}`);
    (error as Error & { traceId?: string }).traceId = traceId;
    (error as Error & { errors?: HaluoMappingError[] }).errors = errors;
    throw error;
  }

  // 通过校验，执行映射
  return mapHaluoOrderToOrderDTO(payload);
}

// ============================================================================
// 批量映射 — 文档 7.3 节 批量导入部分失败处理
// ============================================================================

/**
 * 批量映射结果。
 * 文档参考：production-field-mapping 7.3 节
 */
export interface BatchMappingResult {
  /** 成功映射的 OrderDTO 列表 */
  orders: OrderDTO[];
  /** 逐行错误信息 */
  rowErrors: Array<{
    rowIndex: number;
    externalOrderId?: string;
    errors: HaluoMappingError[];
  }>;
}

/**
 * 批量安全映射。
 * 单条记录失败不阻断其他记录（文档 7.3 节）。
 */
export function mapHaluoOrdersToOrderDTOs(
  payloads: HaluoOrderPayload[],
  traceId?: string
): BatchMappingResult {
  const orders: OrderDTO[] = [];
  const rowErrors: BatchMappingResult["rowErrors"] = [];

  payloads.forEach((payload, index) => {
    try {
      const dto = mapHaluoOrderToOrderDTOSafe(payload, traceId);
      orders.push(dto);
    } catch (err) {
      const errors =
        (err as Error & { errors?: HaluoMappingError[] }).errors ?? [];
      rowErrors.push({
        rowIndex: index,
        externalOrderId: payload.order_id ?? undefined,
        errors: errors.length > 0 ? errors : [
          {
            externalOrderId: payload.order_id,
            field: "unknown",
            message: String(err),
            severity: "P0"
          }
        ]
      });
    }
  });

  if (rowErrors.length > 0) {
    log.warn("batch mapping partial failure", {
      total: String(payloads.length),
      success: String(orders.length),
      failed: String(rowErrors.length),
      traceId: traceId ?? null
    });
  }

  return { orders, rowErrors };
}

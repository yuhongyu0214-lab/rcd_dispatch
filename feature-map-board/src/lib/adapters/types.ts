/**
 * 适配层共享 DTO — 内部统一数据结构。
 *
 * 所有外部平台适配器（哈啰、GPS 厂商等）输出本文件中定义的类型，
 * 业务层只依赖这些 DTO，不直接依赖外部平台的字段名。
 */

/** 外部平台同步过来的订单 */
export type ExternalOrderDTO = {
  /** 外部平台订单号（唯一标识，用于去重） */
  externalOrderId: string;
  /** 来源平台 */
  platform: "haluo";
  /** 订单类型 */
  orderType: "STORE_PICKUP" | "STORE_RETURN" | "DOOR_DELIVERY" | "DOOR_PICKUP";
  /** 外部门店编码 */
  storeCode: string;
  /** 取车地址 */
  pickupAddress: string;
  /** 还车地址 */
  returnAddress: string;
  /** 取车联系人 */
  pickupContactName: string;
  /** 取车联系电话 */
  pickupContactPhone: string;
  /** 预约时间 (ISO 8601) */
  scheduledAt: string;
  /** 车牌号 */
  vehiclePlate: string | null;
  /** 车型 */
  vehicleType: string | null;
  /** 外部平台原始数据（排查问题用） */
  rawPayload: Record<string, unknown>;
};

/** GPS 厂商上报的车辆位置 */
export type VehicleLocationDTO = {
  /** 车牌号 */
  vehiclePlate: string;
  /** 纬度 */
  lat: number;
  /** 经度 */
  lng: number;
  /** 速度 (km/h) */
  speed: number | null;
  /** 航向角 (0–360) */
  heading: number | null;
  /** 位置更新时间 (ISO 8601) */
  updatedAt: string;
};

/** 适配器通用接口 */
export type AdapterResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

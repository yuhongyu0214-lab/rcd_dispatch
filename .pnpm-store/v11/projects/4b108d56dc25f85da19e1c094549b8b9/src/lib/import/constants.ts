export const IMPORT_SOURCE_TYPES = ["XLSX"] as const;

export const IMPORT_REQUIRED_HEADERS = [
  "orderId",
  "orderType",
  "storeId",
  "vehicleType",
  "licensePlate",
  "channel",
  "driverName",
  "pickupAddress",
  "returnAddress",
  "scheduledAt"
] as const;

export const IMPORT_REQUIRED_FIELDS = [...IMPORT_REQUIRED_HEADERS] as const;

export const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROW_COUNT = 200;
export const AMAP_GEOCODE_TIMEOUT_MS = 4000;

export const SUGGESTED_VEHICLE_TYPES = [
  "SUV",
  "SEDAN",
  "MPV",
  "VAN",
  "TRUCK",
  "HATCHBACK"
] as const;

export const IMPORT_FIELD_LABELS: Record<string, string> = {
  orderId: "订单号",
  orderType: "订单类型",
  storeId: "门店编码",
  vehicleType: "车型",
  licensePlate: "车牌号",
  channel: "渠道",
  driverName: "司机姓名",
  pickupAddress: "取车地址",
  returnAddress: "还车地址",
  scheduledAt: "预约时间",
  pickupLat: "取车纬度",
  pickupLng: "取车经度"
};

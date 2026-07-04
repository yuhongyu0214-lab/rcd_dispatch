/**
 * GPS 厂商外部数据结构。
 *
 * 真实接入时，本文件中的 interface 应与 GPS 厂商 API 文档对齐。
 * 当前为 V1 Mock 版本，模拟通用 GPS 终端上报格式。
 *
 * @see 真实接入时替换：GPS 厂商平台文档（如 博实结 / 途强 / 中交兴路）
 */

/** GPS 厂商 API 返回的车辆位置原始数据 */
export type GPSRawVehicleLocation = {
  /** 设备 IMEI 号 */
  imei: string;
  /** 车牌号 */
  plate: string;
  /** 经度 (GCJ-02) */
  lng: number;
  /** 纬度 (GCJ-02) */
  lat: number;
  /** 速度 (km/h) */
  speed: number;
  /** 航向角 (0–360) */
  direction: number;
  /** GPS 定位时间 (Unix 时间戳，秒) */
  gps_time: number;
  /** 数据上报时间 (ISO 8601) */
  report_time: string;
};

/** GPS 厂商单设备查询返回结构 */
export type GPSFetchVehicleLocationResponse = {
  status: number;
  msg: string;
  result: GPSRawVehicleLocation | null;
};

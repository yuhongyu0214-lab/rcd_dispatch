/**
 * 哈啰平台外部数据结构。
 *
 * 真实接入时，本文件中的 interface 应与哈啰 API 文档对齐。
 * 当前为 V1 Mock 版本，字段名模拟哈啰开放平台 v2 订单同步接口。
 *
 * @see 真实接入时替换：哈啰开放平台文档 https://doc.hellobike.com/api/order
 */

/** 哈啰 API 返回的原始订单 */
export type HaluoRawOrder = {
  /** 哈啰订单号 */
  order_id: string;
  /** 订单状态：1-待取车 2-待还车 3-已完成 4-已取消 */
  order_status: number;
  /** 订单类型：1-到店取还 2-送车上门 3-上门取车 */
  order_type: number;
  /** 门店编码 */
  store_code: string;
  /** 取车地址 */
  pickup_addr: string;
  /** 还车地址 */
  return_addr: string;
  /** 联系人姓名 */
  contact_name: string;
  /** 联系人电话 */
  contact_phone: string;
  /** 预约取车时间 (Unix 时间戳，秒) */
  scheduled_timestamp: number;
  /** 车牌号 */
  plate_number: string;
  /** 车型名称 */
  car_model: string;
  /** 创建时间 (ISO 8601) */
  created_at: string;
};

/** 哈啰 fetchOrders 返回结构 */
export type HaluoFetchOrdersResponse = {
  code: number;
  message: string;
  data: {
    orders: HaluoRawOrder[];
    total: number;
    page: number;
  };
};

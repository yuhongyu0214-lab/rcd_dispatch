/**
 * 哈啰适配器 Mock 实现。
 *
 * 模拟哈啰开放平台订单同步接口，返回固定样本数据。
 * 模拟网络延迟 200–600ms，模拟 5% 概率返回服务端错误。
 *
 * ⚠️ 真实接入时：
 *   1. 将 fetchOrders() 中的 mock 逻辑替换为 HTTP 调用哈啰 API
 *   2. 保持函数签名不变（入参/返回值类型不变）
 *   3. 替换位置标注了 "@replace" 注释
 */

import type { AdapterResult, ExternalOrderDTO } from "../types";
import { mapHaluoOrdersToDTO } from "./mapper";
import type { HaluoFetchOrdersResponse, HaluoRawOrder } from "./types";

// ---------------------------------------------------------------------------
// Mock 数据
// ---------------------------------------------------------------------------

const MOCK_HALUO_ORDERS: HaluoRawOrder[] = [
  {
    order_id: "HL202607010001",
    order_status: 1,
    order_type: 1,
    store_code: "SH001",
    pickup_addr: "上海市浦东新区张江高科技园区碧波路690号",
    return_addr: "上海市浦东新区陆家嘴环路1000号",
    contact_name: "李明",
    contact_phone: "13800138001",
    scheduled_timestamp: Math.floor(Date.now() / 1000) + 7200,
    plate_number: "沪A12345",
    car_model: "丰田卡罗拉",
    created_at: new Date().toISOString()
  },
  {
    order_id: "HL202607010002",
    order_status: 1,
    order_type: 3,
    store_code: "SH001",
    pickup_addr: "上海市徐汇区漕溪北路595号上海体育馆",
    return_addr: "上海市静安区南京西路1266号恒隆广场",
    contact_name: "王芳",
    contact_phone: "13900139002",
    scheduled_timestamp: Math.floor(Date.now() / 1000) + 14400,
    plate_number: "沪B67890",
    car_model: "本田雅阁",
    created_at: new Date().toISOString()
  }
];

// ---------------------------------------------------------------------------
// Mock 工具
// ---------------------------------------------------------------------------

/** 模拟网络延迟 */
function randomDelay(): Promise<void> {
  const ms = 200 + Math.random() * 400;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 模拟 5% 概率服务端错误 */
function shouldSimulateError(): boolean {
  return Math.random() < 0.05;
}

/**
 * 从哈啰平台拉取订单列表。
 *
 * V1 Mock：返回 2 条上海门店的样本订单。
 * 真实接入时替换为哈啰 API HTTP 调用。
 *
 * @param storeCode — 门店编码（可选，不传则返回所有门店订单）
 * @param page — 页码
 * @returns AdapterResult<ExternalOrderDTO[]>
 *
 * @replace 真实接入：将本函数体替换为 fetch(HELLO_API_URL, { headers: { Authorization } })
 */
export async function fetchOrders(
  storeCode?: string,
  page = 1
): Promise<AdapterResult<ExternalOrderDTO[]>> {
  // @replace: 模拟网络延迟，真实接入时删除此行
  await randomDelay();

  // @replace: 模拟 5% 概率错误，真实接入时替换为 HTTP 状态码判断
  if (shouldSimulateError()) {
    return {
      success: false,
      error: "哈啰平台暂时不可用，请稍后重试（Mock 模拟错误）"
    };
  }

  // @replace: 模拟响应，真实接入时替换为 HTTP 响应解包
  const mockResponse: HaluoFetchOrdersResponse = {
    code: 0,
    message: "success",
    data: {
      orders: MOCK_HALUO_ORDERS,
      total: MOCK_HALUO_ORDERS.length,
      page
    }
  };

  if (mockResponse.code !== 0) {
    return {
      success: false,
      error: `哈啰 API 返回异常：${mockResponse.message} (code=${mockResponse.code})`
    };
  }

  // @replace: 以下映射逻辑在真实接入时保持不变
  let orders = mapHaluoOrdersToDTO(mockResponse.data.orders);

  if (storeCode) {
    orders = orders.filter((o) => o.storeCode === storeCode);
  }

  return { success: true, data: orders };
}

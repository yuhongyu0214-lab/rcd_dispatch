import { describe, expect, it } from "vitest";

import { fetchHaluoOrders } from "./index";

describe("哈啰适配器", () => {
  it("fetchHaluoOrders() 返回至少 2 条订单 DTO", async () => {
    // 多次重试以覆盖模拟 5% 错误概率
    let result = await fetchHaluoOrders();
    let retries = 0;

    while (!result.success && retries < 10) {
      retries += 1;
      result = await fetchHaluoOrders();
    }

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBeGreaterThanOrEqual(2);
      // 验证 DTO 结构
      const order = result.data[0];
      expect(order.externalOrderId).toBeTruthy();
      expect(order.platform).toBe("haluo");
      expect(order.pickupAddress).toBeTruthy();
      expect(order.returnAddress).toBeTruthy();
      expect(order.storeCode).toBe("SH001");
    }
  });

  it("fetchHaluoOrders(storeCode) 可按门店筛选", async () => {
    let result = await fetchHaluoOrders("SH001");
    let retries = 0;

    while (!result.success && retries < 10) {
      retries += 1;
      result = await fetchHaluoOrders("SH001");
    }

    expect(result.success).toBe(true);
    if (result.success) {
      result.data.forEach((o) => {
        expect(o.storeCode).toBe("SH001");
      });
    }
  });
});

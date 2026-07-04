import { describe, expect, it } from "vitest";

import { fetchVehicleGPSLocation } from "./index";

describe("GPS 适配器", () => {
  it("fetchVehicleGPSLocation(vehicleId) 返回 { lat, lng, updatedAt }", async () => {
    // 多次重试以覆盖模拟 3% 离线概率
    let result = await fetchVehicleGPSLocation("沪A12345");
    let retries = 0;

    while (!result.success && retries < 10) {
      retries += 1;
      result = await fetchVehicleGPSLocation("沪A12345");
    }

    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.lat).toBe("number");
      expect(typeof result.data.lng).toBe("number");
      expect(typeof result.data.updatedAt).toBe("string");
      expect(result.data.vehiclePlate).toBe("沪A12345");
    }
  });

  it("fetchVehicleGPSLocation 对未知车辆返回默认坐标", async () => {
    let result = await fetchVehicleGPSLocation("京B99999");
    let retries = 0;

    while (!result.success && retries < 10) {
      retries += 1;
      result = await fetchVehicleGPSLocation("京B99999");
    }

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lat).toBeGreaterThan(0);
      expect(result.data.lng).toBeGreaterThan(0);
    }
  });
});

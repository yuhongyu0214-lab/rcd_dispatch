import { describe, expect, it } from "vitest";

import { fetchVehicleLocation } from "./gps";
import { fetchOrders } from "./haluo";

describe("integration adapters", () => {
  it("maps mock Haluo orders to internal order DTOs", async () => {
    const orders = await fetchOrders();

    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      orderNo: "HL-20260628-001",
      type: "STORE_PICKUP",
      status: "PENDING",
      storeName: "上海虹桥门店",
      source: "HALUO_MOCK"
    });
    expect(orders[0]?.pickupCoordinate).toEqual({
      lat: 31.1942,
      lng: 121.3268
    });
  });

  it("returns mock GPS vehicle location contract", async () => {
    await expect(fetchVehicleLocation("vehicle-sh-hq-001")).resolves.toEqual({
      lat: 31.1942,
      lng: 121.3268,
      updatedAt: "2026-06-28T09:42:00.000+08:00"
    });
  });
});

import { DriverStatus, OrderStatus, VehicleStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildMapSummary, DEFAULT_MAP_CENTER, offsetCoordinate } from "./points";
import type {
  MapDriverPoint,
  MapOrderPoint,
  MapStorePoint,
  MapVehiclePoint
} from "./types";

describe("map points", () => {
  it("builds map summary from point status", () => {
    const orders = [
      {
        kind: "ORDER",
        id: "order-1",
        orderNo: "RCD-001",
        type: "STORE_PICKUP",
        status: OrderStatus.PENDING,
        pickupAddress: "上海站",
        returnAddress: "虹桥站",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        storeName: "人民广场门店",
        vehicleLabel: null,
        coordinate: { lat: 31.23, lng: 121.47, source: "ORDER" }
      },
      {
        kind: "ORDER",
        id: "order-2",
        orderNo: "RCD-002",
        type: "STORE_RETURN",
        status: OrderStatus.ASSIGNED,
        pickupAddress: "静安寺",
        returnAddress: "陆家嘴",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z").toISOString(),
        storeName: "人民广场门店",
        vehicleLabel: "沪A12345",
        coordinate: { lat: 31.22, lng: 121.48, source: "ORDER" }
      }
    ] satisfies MapOrderPoint[];
    const drivers = [
      {
        kind: "DRIVER",
        id: "driver-1",
        name: "王师傅",
        phone: "13800000000",
        status: DriverStatus.S1,
        storeName: "人民广场门店",
        coordinate: { lat: 31.23, lng: 121.47, source: "MOCK" },
        lastSeenAt: null
      },
      {
        kind: "DRIVER",
        id: "driver-2",
        name: "李师傅",
        phone: "13900000000",
        status: DriverStatus.OFFLINE,
        storeName: "人民广场门店",
        coordinate: { lat: 31.23, lng: 121.47, source: "MOCK" },
        lastSeenAt: null
      }
    ] satisfies MapDriverPoint[];
    const vehicles = [
      {
        kind: "VEHICLE",
        id: "vehicle-1",
        licensePlate: "沪A12345",
        vehicleType: "经济型",
        status: VehicleStatus.AVAILABLE,
        storeName: "人民广场门店",
        coordinate: { lat: 31.23, lng: 121.47, source: "VEHICLE" }
      }
    ] satisfies MapVehiclePoint[];
    const stores = [
      {
        kind: "STORE",
        id: "store-1",
        code: "STORE_SH",
        name: "人民广场门店",
        status: "ACTIVE",
        storeName: "人民广场门店",
        coordinate: { lat: 31.23, lng: 121.47, source: "STORE" }
      }
    ] satisfies MapStorePoint[];

    expect(buildMapSummary(orders, drivers, vehicles, stores)).toEqual({
      orderCount: 2,
      pendingOrderCount: 1,
      driverCount: 2,
      activeDriverCount: 1,
      vehicleCount: 1,
      availableVehicleCount: 1,
      storeCount: 1
    });
  });

  it("creates stable mock offsets around the default center", () => {
    expect(offsetCoordinate(DEFAULT_MAP_CENTER, 0)).toEqual({
      lat: 31.2304,
      lng: 121.4782,
      source: "MOCK"
    });
  });
});

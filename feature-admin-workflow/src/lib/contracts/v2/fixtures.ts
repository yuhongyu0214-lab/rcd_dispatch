import type {
  AssignmentV2,
  CanonicalOrderV2,
  DispatchInputV2,
  DriverV2,
  OrderV2
} from "@/types/v2";

export const FIXTURE_CANONICAL_ORDER_V2 = {
  sourceSystem: "HALUO",
  externalOrderId: "haluo-order-001",
  sourceVersion: "2026-07-18T08:00:00.000Z",
  sourceStatusRaw: "待取车",
  orderNo: "ORDER-V2-001",
  businessType: "STORE_PICKUP",
  promisedPickupAt: "2026-07-18T09:00:00.000Z",
  receivedAt: "2026-07-18T08:00:01.000Z",
  pickupAddress: "杭州市西湖区取车点",
  pickupLat: 30.2741,
  pickupLng: 120.1551,
  deliveryAddress: "杭州市拱墅区送达点",
  deliveryLat: 30.319,
  deliveryLng: 120.142,
  storeCode: "STORE_HZ_XH",
  licensePlateSnapshot: "浙A00001"
} satisfies CanonicalOrderV2;

export const FIXTURE_ORDER_V2 = {
  id: "order-v2-001",
  orderNo: "ORDER-V2-001",
  sourceSystem: "HALUO",
  externalOrderId: "haluo-order-001",
  sourceVersion: "2026-07-18T08:00:00.000Z",
  businessType: "STORE_PICKUP",
  executionStatus: "UNASSIGNED",
  feasibility: "UNKNOWN",
  slackMinutes: null,
  promisedPickupAt: "2026-07-18T09:00:00.000Z",
  receivedAt: "2026-07-18T08:00:01.000Z",
  pickupAddress: "杭州市西湖区取车点",
  pickupLat: 30.2741,
  pickupLng: 120.1551,
  deliveryAddress: "杭州市拱墅区送达点",
  deliveryLat: 30.319,
  deliveryLng: 120.142,
  storeCode: "STORE_HZ_XH",
  licensePlateSnapshot: "浙A00001",
  createdAt: "2026-07-18T08:00:01.000Z",
  updatedAt: "2026-07-18T08:00:01.000Z"
} satisfies OrderV2;

export const FIXTURE_ASSIGNMENT_V2 = {
  id: "assignment-v2-001",
  orderId: "order-v2-001",
  driverId: "driver-v2-001",
  sequenceNo: 1,
  slot: "A",
  lockType: "NONE",
  etaAvailable: true
} satisfies AssignmentV2;

export const FIXTURE_DRIVER_V2 = {
  id: "driver-v2-001",
  name: "测试司机",
  storeCode: "STORE_HZ_XH",
  onShift: true,
  shiftStartedAt: "2026-07-18T07:30:00.000Z",
  availability: "AVAILABLE",
  planVersion: 1,
  locationFreshness: "FRESH",
  lastLocation: {
    lat: 30.2741,
    lng: 120.1551,
    accuracyMeters: 20,
    capturedAt: "2026-07-18T08:00:00.000Z"
  },
  slots: {}
} satisfies DriverV2;

export const FIXTURE_DISPATCH_INPUT_V2 = {
  event: {
    type: "ORDER_RECEIVED",
    occurredAt: "2026-07-18T08:00:01.000Z",
    orderId: "order-v2-001"
  },
  orders: [
    {
      orderId: "order-v2-001",
      orderNo: "ORDER-V2-001",
      businessType: "STORE_PICKUP",
      executionStatus: "UNASSIGNED",
      feasibility: "UNKNOWN",
      slackMinutes: null,
      promisedPickupAt: "2026-07-18T09:00:00.000Z",
      pickupAddress: "杭州市西湖区取车点",
      pickupLocation: { lat: 30.2741, lng: 120.1551 },
      deliveryAddress: "杭州市拱墅区送达点",
      deliveryLocation: { lat: 30.319, lng: 120.142 },
      storeCode: "STORE_HZ_XH",
      serviceModuleMinutes: 0
    }
  ],
  drivers: [
    {
      driverId: "driver-v2-001",
      storeCode: "STORE_HZ_XH",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 1,
      locationFreshness: "FRESH",
      lastLocation: FIXTURE_DRIVER_V2.lastLocation,
      assignments: []
    }
  ]
} satisfies DispatchInputV2;

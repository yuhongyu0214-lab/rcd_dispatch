import {
  DriverStatus,
  OrderStatus,
  VehicleStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { VISIBLE_ORDER_STATUSES } from "@/lib/ingest/normalize";
import { getDriverLocations } from "@/lib/redis";
import type { DriverLocation } from "@/lib/redis";

import { DEFAULT_MAP_CENTER } from "./constants";
import { toOrderDisplayDTO } from "./order-display-dto";
import type {
  MapBoardPayload,
  MapBoardSummary,
  MapCoordinate,
  MapDriverPoint,
  MapOrderPoint,
  MapStorePoint,
  MapVehiclePoint
} from "./types";

export { DEFAULT_MAP_CENTER };

export type GetMapBoardParams = {
  /** 按门店筛选点位（可选） */
  storeId?: string;
  /** 按对象类型筛选。不传则加载全部类型。 */
  objectTypes?: string[];
};

const visibleOrderStatuses: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.RECOMMENDING,
  OrderStatus.ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS
];

function hasCoordinate(lat: number | null, lng: number | null) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

export function offsetCoordinate(
  base: Pick<MapCoordinate, "lat" | "lng">,
  index: number
): MapCoordinate {
  const ring = Math.floor(index / 8) + 1;
  const angle = ((index % 8) / 8) * Math.PI * 2;
  const radius = 0.0045 * ring;

  return {
    lat: Number((base.lat + Math.sin(angle) * radius).toFixed(6)),
    lng: Number((base.lng + Math.cos(angle) * radius).toFixed(6)),
    source: "MOCK"
  };
}

/**
 * 从点位数组中计算动态地图中心。
 * 优先级分段查找：车辆真实GPS → 司机实时位置 → 订单坐标 → 门店坐标 → 上海默认
 * 避免混排导致的回退点抢占（如车辆回退到司机位置时被误判为车辆GPS）。
 */
function computeDynamicCenter(
  vehiclePoints: MapVehiclePoint[],
  driverPoints: MapDriverPoint[],
  orderPoints: MapOrderPoint[],
  storePoints: MapStorePoint[]
): { lat: number; lng: number } {
  // 1. 车辆自身 GPS（排除回退到司机/默认的坐标）
  const vehicleGps = vehiclePoints.find((p) => p.coordinate.source === "VEHICLE");
  if (vehicleGps) return { lat: vehicleGps.coordinate.lat, lng: vehicleGps.coordinate.lng };

  // 2. 司机实时位置（Redis 或 DB）
  const driverPos = driverPoints.find((p) => p.coordinate.source === "REDIS" || p.coordinate.source === "DRIVER");
  if (driverPos) return { lat: driverPos.coordinate.lat, lng: driverPos.coordinate.lng };

  // 3. 订单真实坐标
  const orderPos = orderPoints.find((p) => p.coordinate.source === "ORDER");
  if (orderPos) return { lat: orderPos.coordinate.lat, lng: orderPos.coordinate.lng };

  // 4. 门店真实 GPS
  const storePos = storePoints.find((p) => p.coordinate.source === "STORE");
  if (storePos) return { lat: storePos.coordinate.lat, lng: storePos.coordinate.lng };

  // 5. 最终回退
  return DEFAULT_MAP_CENTER;
}

export function buildMapSummary(
  orders: MapOrderPoint[],
  drivers: MapDriverPoint[],
  vehicles: MapVehiclePoint[],
  stores: MapStorePoint[] = []
): MapBoardSummary {
  return {
    orderCount: orders.length,
    pendingOrderCount: orders.filter((order) => order.status === OrderStatus.PENDING)
      .length,
    driverCount: drivers.length,
    activeDriverCount: drivers.filter((driver) => driver.status !== DriverStatus.OFFLINE)
      .length,
    vehicleCount: vehicles.length,
    availableVehicleCount: vehicles.filter(
      (vehicle) => vehicle.status === VehicleStatus.AVAILABLE
    ).length,
    storeCount: stores.length
  };
}

export async function getMapBoardData(
  params: GetMapBoardParams = {}
): Promise<MapBoardPayload> {
  const { storeId, objectTypes } = params;

  // 判断需要加载哪些类型（默认全部）
  const types =
    objectTypes && objectTypes.length > 0
      ? new Set(objectTypes.map((t) => t.toUpperCase()))
      : null;
  const shouldLoad = (kind: string) => !types || types.has(kind.toUpperCase());

  // 构建 DB 查询过滤条件
  const storeFilter = storeId ? { storeId } : ({} as Record<string, unknown>);

  const [orders, drivers, vehicles, stores] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: visibleOrderStatuses },
        ...storeFilter
      },
      include: {
        store: true,
        vehicle: true
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: shouldLoad("orders") || shouldLoad("alerts") ? 200 : 0
    }),
    prisma.driver.findMany({
      where: {
        isActive: true,
        ...storeFilter
      },
      include: {
        store: true
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: shouldLoad("drivers") || shouldLoad("alerts") ? 200 : 0
    }),
    prisma.vehicle.findMany({
      where: {
        isActive: true,
        ...storeFilter
      },
      include: {
        store: true
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: shouldLoad("vehicles") || shouldLoad("alerts") ? 200 : 0
    }),
    prisma.store.findMany({
      where: {
        isActive: true
      },
      orderBy: [{ code: "asc" }],
      take: shouldLoad("stores") ? 50 : 0
    })
  ]);

  // 按 storeId 对车辆分组（多场景使用）
  const vehiclesByStore = vehicles.reduce<Map<string, typeof vehicles>>(
    (grouped, vehicle) => {
      const storeVehicles = grouped.get(vehicle.storeId) ?? [];
      storeVehicles.push(vehicle);
      grouped.set(vehicle.storeId, storeVehicles);
      return grouped;
    },
    new Map()
  );

  // 批量获取 Redis 司机位置（用于 driverPoints 和 vehiclePoints 回退）
  let redisLocations: Map<string, DriverLocation | null> = new Map();
  if (drivers.length > 0) {
    redisLocations = await getDriverLocations(drivers.map((d) => d.id));
  }

  // 构建按门店分组的司机位置索引（vehicle 回退时使用）
  const storeDriverLocationIndex = new Map<
    string,
    { lat: number; lng: number; hasGps: boolean }
  >();
  for (const driver of drivers) {
    const redisLoc = redisLocations.get(driver.id);
    if (redisLoc?.lat && redisLoc?.lng) {
      storeDriverLocationIndex.set(driver.storeId, {
        lat: Number(redisLoc.lat),
        lng: Number(redisLoc.lng),
        hasGps: true
      });
    } else if (hasCoordinate(driver.lastLat, driver.lastLng)) {
      if (!storeDriverLocationIndex.has(driver.storeId)) {
        storeDriverLocationIndex.set(driver.storeId, {
          lat: driver.lastLat!,
          lng: driver.lastLng!,
          hasGps: true
        });
      }
    }
  }

  // ---- 车辆点位 ----
  const vehiclePoints: MapVehiclePoint[] = vehicles.map((vehicle, index) => {
    let coordinate: MapCoordinate;

    if (hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)) {
      coordinate = {
        lat: vehicle.gpsLat!,
        lng: vehicle.gpsLng!,
        source: "VEHICLE" as const
      };
    } else {
      // 回退到同门店司机的最后位置
      const storeDriverPos = storeDriverLocationIndex.get(vehicle.storeId);
      if (storeDriverPos?.hasGps) {
        coordinate = {
          lat: storeDriverPos.lat,
          lng: storeDriverPos.lng,
          source: "DRIVER" as const
        };
      } else {
        coordinate = offsetCoordinate(DEFAULT_MAP_CENTER, index);
      }
    }

    return {
      kind: "VEHICLE",
      id: vehicle.id,
      licensePlate: vehicle.licensePlate,
      vehicleType: vehicle.vehicleType,
      status: vehicle.status,
      storeName: vehicle.store.name,
      coordinate
    };
  });

  // ---- 订单点位（所有订单进入列表，有坐标落图，缺坐标 FALLBACK 不落图）----
  const orderPoints: MapOrderPoint[] = [];

  for (const order of orders) {
    const hasCoord = hasCoordinate(order.pickupLat, order.pickupLng);
    const display = toOrderDisplayDTO(order);

    orderPoints.push({
      kind: "ORDER",
      id: order.id,
      orderNo: order.orderNo,
      type: order.type,
      status: order.status,
      pickupAddress: order.pickupAddress,
      returnAddress: order.returnAddress,
      scheduledAt: order.scheduledAt.toISOString(),
      storeName: order.store.name,
      vehicleLabel:
        order.licensePlateSnapshot ?? order.vehicle?.licensePlate ?? null,
      coordinate: hasCoord
        ? { lat: order.pickupLat!, lng: order.pickupLng!, source: "ORDER" as const }
        : { lat: 0, lng: 0, source: "FALLBACK" as const },
      display,
    });
  }

  // ---- 司机点位（Redis 优先）----
  const driverPoints: MapDriverPoint[] = drivers.map((driver, index) => {
    const redisLoc = redisLocations.get(driver.id);
    let coordinate: MapCoordinate;
    let lastSeenAt: string | null = null;

    if (redisLoc?.lat && redisLoc?.lng) {
      coordinate = {
        lat: Number(redisLoc.lat),
        lng: Number(redisLoc.lng),
        source: "REDIS" as const
      };
      // Redis server_ts 是毫秒时间戳字符串
      lastSeenAt = redisLoc.server_ts
        ? new Date(Number(redisLoc.server_ts)).toISOString()
        : new Date().toISOString();
    } else if (hasCoordinate(driver.lastLat, driver.lastLng)) {
      coordinate = {
        lat: driver.lastLat!,
        lng: driver.lastLng!,
        source: "DRIVER" as const
      };
      // 用 DB 的 updatedAt 作为最后活跃时间
      lastSeenAt = driver.updatedAt.toISOString();
    } else {
      // 最终回退：基于门店车辆位置做偏移
      const storeVehicle = vehiclesByStore.get(driver.storeId)?.[index % 3];
      const base = hasCoordinate(
        storeVehicle?.gpsLat ?? null,
        storeVehicle?.gpsLng ?? null
      )
        ? {
            lat: storeVehicle!.gpsLat!,
            lng: storeVehicle!.gpsLng!
          }
        : DEFAULT_MAP_CENTER;

      coordinate = offsetCoordinate(base, index + 1);
      lastSeenAt = null;
    }

    return {
      kind: "DRIVER",
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      status: driver.status,
      storeName: driver.store.name,
      coordinate,
      lastSeenAt
    };
  });

  // ---- 门店点位 ----
  const storePoints: MapStorePoint[] = stores.map((store, index) => {
    const storeVehicles = vehiclesByStore.get(store.id) ?? [];
    const firstVehicleWithGps = storeVehicles.find((vehicle) =>
      hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)
    );
    let coordinate: MapCoordinate;

    if (firstVehicleWithGps) {
      coordinate = {
        lat: firstVehicleWithGps.gpsLat!,
        lng: firstVehicleWithGps.gpsLng!,
        source: "STORE" as const
      };
    } else {
      const storeDriverPos = storeDriverLocationIndex.get(store.id);
      if (storeDriverPos?.hasGps) {
        coordinate = {
          lat: storeDriverPos.lat,
          lng: storeDriverPos.lng,
          source: "DRIVER" as const
        };
      } else {
        coordinate = offsetCoordinate(
          DEFAULT_MAP_CENTER,
          index + vehiclePoints.length + orderPoints.length
        );
      }
    }

    return {
      kind: "STORE",
      id: store.id,
      code: store.code,
      name: store.name,
      status: store.isActive ? "ACTIVE" : "INACTIVE",
      storeName: store.name,
      coordinate
    };
  });

  // 动态地图中心：从第一个真实 GPS 坐标计算，避免硬编码上海
  const mapCenter = computeDynamicCenter(vehiclePoints, driverPoints, orderPoints, storePoints);

  return {
    orders: orderPoints,
    drivers: driverPoints,
    vehicles: vehiclePoints,
    stores: storePoints,
    summary: buildMapSummary(
      orderPoints,
      driverPoints,
      vehiclePoints,
      storePoints
    ),
    mapCenter,
    generatedAt: new Date().toISOString()
  };
}

import {
  DriverStatus,
  OrderStatus,
  VehicleStatus
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

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

export const DEFAULT_MAP_CENTER = {
  lat: 31.2304,
  lng: 121.4737
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

export async function getMapBoardData(): Promise<MapBoardPayload> {
  const [orders, drivers, vehicles, stores] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: {
          in: visibleOrderStatuses
        }
      },
      include: {
        store: true,
        vehicle: true
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: 200
    }),
    prisma.driver.findMany({
      where: {
        isActive: true
      },
      include: {
        store: true
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200
    }),
    prisma.vehicle.findMany({
      where: {
        isActive: true
      },
      include: {
        store: true
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200
    }),
    prisma.store.findMany({
      where: {
        isActive: true
      },
      orderBy: [{ code: "asc" }],
      take: 50
    })
  ]);

  const vehiclesByStore = vehicles.reduce<Map<string, typeof vehicles>>(
    (grouped, vehicle) => {
      const storeVehicles = grouped.get(vehicle.storeId) ?? [];
      storeVehicles.push(vehicle);
      grouped.set(vehicle.storeId, storeVehicles);
      return grouped;
    },
    new Map()
  );

  const vehiclePoints: MapVehiclePoint[] = vehicles.map((vehicle, index) => {
    const coordinate = hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)
      ? {
          lat: vehicle.gpsLat ?? DEFAULT_MAP_CENTER.lat,
          lng: vehicle.gpsLng ?? DEFAULT_MAP_CENTER.lng,
          source: "VEHICLE" as const
        }
      : offsetCoordinate(DEFAULT_MAP_CENTER, index);

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

  const orderPoints: MapOrderPoint[] = orders.map((order, index) => {
    const display = toOrderDisplayDTO(order);
    const fallbackVehicle = order.vehicle ?? vehiclesByStore.get(order.storeId)?.[0];
    const coordinate = hasCoordinate(order.pickupLat, order.pickupLng)
      ? {
          lat: order.pickupLat ?? DEFAULT_MAP_CENTER.lat,
          lng: order.pickupLng ?? DEFAULT_MAP_CENTER.lng,
          source: "ORDER" as const
        }
      : hasCoordinate(fallbackVehicle?.gpsLat ?? null, fallbackVehicle?.gpsLng ?? null)
        ? {
            lat: fallbackVehicle?.gpsLat ?? DEFAULT_MAP_CENTER.lat,
            lng: fallbackVehicle?.gpsLng ?? DEFAULT_MAP_CENTER.lng,
            source: "VEHICLE" as const
          }
        : {
            ...offsetCoordinate(DEFAULT_MAP_CENTER, index + vehiclePoints.length),
            source: "FALLBACK" as const
          };

    return {
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
      coordinate,
      display
    };
  });

  const driverPoints: MapDriverPoint[] = drivers.map((driver, index) => {
    const storeVehicle = vehiclesByStore.get(driver.storeId)?.[index % 3];
    const base = hasCoordinate(storeVehicle?.gpsLat ?? null, storeVehicle?.gpsLng ?? null)
      ? {
          lat: storeVehicle?.gpsLat ?? DEFAULT_MAP_CENTER.lat,
          lng: storeVehicle?.gpsLng ?? DEFAULT_MAP_CENTER.lng
        }
      : DEFAULT_MAP_CENTER;

    return {
      kind: "DRIVER",
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      status: driver.status,
      storeName: driver.store.name,
      coordinate: offsetCoordinate(base, index + 1)
    };
  });

  const storePoints: MapStorePoint[] = stores.map((store, index) => {
    const storeVehicles = vehiclesByStore.get(store.id) ?? [];
    const firstVehicleWithGps = storeVehicles.find((vehicle) =>
      hasCoordinate(vehicle.gpsLat, vehicle.gpsLng)
    );
    const coordinate = firstVehicleWithGps
      ? {
          lat: firstVehicleWithGps.gpsLat ?? DEFAULT_MAP_CENTER.lat,
          lng: firstVehicleWithGps.gpsLng ?? DEFAULT_MAP_CENTER.lng,
          source: "STORE" as const
        }
      : offsetCoordinate(DEFAULT_MAP_CENTER, index + vehiclePoints.length + orderPoints.length);

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

  return {
    orders: orderPoints,
    drivers: driverPoints,
    vehicles: vehiclePoints,
    stores: storePoints,
    summary: buildMapSummary(orderPoints, driverPoints, vehiclePoints, storePoints),
    generatedAt: new Date().toISOString()
  };
}

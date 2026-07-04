import type { DriverStatus, OrderStatus, OrderType, VehicleStatus } from "@prisma/client";

type OrderDisplayStore = {
  id: string;
  code?: string;
  name: string;
};

type OrderDisplayVehicle = {
  id: string;
  licensePlate: string;
  vehicleType: string;
  status?: VehicleStatus;
} | null;

type OrderDisplayDriver = {
  id: string;
  name: string;
  phone?: string;
  status: DriverStatus;
};

type OrderDisplayAssignment = {
  id: string;
  driverId: string;
  driver: OrderDisplayDriver;
} | null;

export type OrderDisplaySource = {
  id: string;
  orderNo: string;
  type: OrderType;
  status: OrderStatus;
  storeId: string;
  vehicleId?: string | null;
  licensePlateSnapshot?: string | null;
  importBatchId?: string | null;
  channel?: string | null;
  driverNameSnapshot?: string | null;
  vehicleTypeSnapshot?: string | null;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: Date | string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  store: OrderDisplayStore;
  vehicle?: OrderDisplayVehicle;
  currentAssignment?: OrderDisplayAssignment;
};

export type OrderDisplayDTO = {
  id: string;
  orderNo: string;
  rawOrderNo: string;
  type: OrderType;
  typeText: string;
  status: OrderStatus;
  statusText: string;
  displayStatus: string;
  storeId: string;
  storeName: string;
  plate: string;
  licensePlateSnapshot: string | null;
  driverId: string | null;
  driverName: string | null;
  pickupName: string;
  returnName: string;
  pickupAddress: string;
  returnAddress: string;
  scheduledAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  progress: "CLEANING" | "ENERGY_REFILL" | "READY" | "IN_PROGRESS" | "REVIEW" | "NONE";
  progressText: string;
  locked: boolean;
  source: string;
  traceId: string;
  insertedAt: string;
  createdAt: string;
  updatedAt: string | null;
  vehicle: {
    id: string;
    licensePlate: string;
    vehicleType: string;
  } | null;
  currentAssignment: OrderDisplayAssignment;
  store: OrderDisplayStore;
};

const orderTypeText: Record<OrderType, string> = {
  STORE_PICKUP: "到店取车",
  STORE_RETURN: "到店还车",
  DOOR_DELIVERY: "送车上门",
  DOOR_PICKUP: "上门取车"
};

const statusText: Record<OrderStatus, string> = {
  PENDING: "待分配",
  RECOMMENDING: "推荐中",
  ASSIGNED: "已派单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "执行中",
  COMPLETED: "已完成",
  RECYCLED: "已回收",
  CANCELLED: "已取消"
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  return value instanceof Date ? value.toISOString() : value;
}

function addHours(value: Date | string, hours: number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function hashText(value: string) {
  return value.split("").reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) % 9973;
  }, 0);
}

export function formatOrderDisplayNo(orderNo: string) {
  const numericSuffix = orderNo.match(/(\d{3,})$/)?.[1];
  if (numericSuffix) {
    return `D${numericSuffix.slice(-4).padStart(4, "0")}`;
  }

  return `D${String(3800 + (hashText(orderNo) % 200)).padStart(4, "0")}`;
}

export function mapOrderDisplayStatus(status: OrderStatus, type: OrderType) {
  if (status === "COMPLETED") {
    return "已完成";
  }

  if (status === "CANCELLED") {
    return "已取消";
  }

  if (status === "RECYCLED") {
    return "待复核";
  }

  if (type === "STORE_RETURN" || type === "DOOR_PICKUP" || status === "IN_PROGRESS") {
    return "待还车";
  }

  return "待取车";
}

export function mapOrderProgress(status: OrderStatus) {
  if (status === "PENDING" || status === "RECOMMENDING") {
    return { progress: "CLEANING" as const, progressText: "清洁中" };
  }

  if (status === "ASSIGNED" || status === "ACCEPTED") {
    return { progress: "ENERGY_REFILL" as const, progressText: "补能中" };
  }

  if (status === "IN_PROGRESS") {
    return { progress: "IN_PROGRESS" as const, progressText: "执行中" };
  }

  if (status === "RECYCLED") {
    return { progress: "REVIEW" as const, progressText: "待复核" };
  }

  if (status === "COMPLETED") {
    return { progress: "READY" as const, progressText: "已整备" };
  }

  return { progress: "NONE" as const, progressText: "已取消" };
}

export function toOrderDisplayDTO(dbOrder: OrderDisplaySource): OrderDisplayDTO {
  const scheduledStartAt = toIsoString(dbOrder.scheduledAt);
  const scheduledEndAt = addHours(dbOrder.scheduledAt, 2);
  const { progress, progressText } = mapOrderProgress(dbOrder.status);
  const plate =
    dbOrder.licensePlateSnapshot ?? dbOrder.vehicle?.licensePlate ?? "未绑定车牌";
  const driverName =
    dbOrder.currentAssignment?.driver.name ?? dbOrder.driverNameSnapshot ?? null;

  return {
    id: dbOrder.id,
    orderNo: formatOrderDisplayNo(dbOrder.orderNo),
    rawOrderNo: dbOrder.orderNo,
    type: dbOrder.type,
    typeText: orderTypeText[dbOrder.type],
    status: dbOrder.status,
    statusText: statusText[dbOrder.status],
    displayStatus: mapOrderDisplayStatus(dbOrder.status, dbOrder.type),
    storeId: dbOrder.storeId,
    storeName: dbOrder.store.name,
    plate,
    licensePlateSnapshot: dbOrder.licensePlateSnapshot ?? null,
    driverId: dbOrder.currentAssignment?.driverId ?? null,
    driverName,
    pickupName: dbOrder.pickupAddress,
    returnName: dbOrder.returnAddress,
    pickupAddress: dbOrder.pickupAddress,
    returnAddress: dbOrder.returnAddress,
    scheduledAt: scheduledStartAt,
    scheduledStartAt,
    scheduledEndAt,
    progress,
    progressText,
    locked: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(dbOrder.status),
    source: dbOrder.channel ?? "订单自动传入",
    traceId: dbOrder.importBatchId ? `trc-${dbOrder.importBatchId}` : `trc-${dbOrder.id.slice(-8)}`,
    insertedAt: toIsoString(dbOrder.createdAt),
    createdAt: toIsoString(dbOrder.createdAt),
    updatedAt: dbOrder.updatedAt ? toIsoString(dbOrder.updatedAt) : null,
    vehicle: dbOrder.vehicle
      ? {
          id: dbOrder.vehicle.id,
          licensePlate: dbOrder.vehicle.licensePlate,
          vehicleType: dbOrder.vehicle.vehicleType
        }
      : null,
    currentAssignment: dbOrder.currentAssignment ?? null,
    store: dbOrder.store
  };
}

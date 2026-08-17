import { prisma } from "@/lib/prisma";

import type { DriverTaskV2, ServicePlanV2 } from "@/types/v2";

import type { DriverOrderMarkerViewV2 } from "./types";
import { parseStoredServiceModules } from "./service-modules";

function point(lat: number | null, lng: number | null) {
  return lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
    ? { lat, lng }
    : undefined;
}

function displayText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function slotFromSequence(sequenceNo: number | null) {
  if (sequenceNo === 1) return "A" as const;
  if (sequenceNo === 2) return "B" as const;
  return "C" as const;
}

function servicePlanView(
  assignmentId: string,
  servicePlan: {
    modulesJson: unknown;
    totalModuleMinutes: number;
    revision: number;
    updatedAt: Date;
    updatedByUserId: string | null;
  } | null
): ServicePlanV2 | null {
  if (!servicePlan) return null;
  return {
    assignmentId,
    modules: parseStoredServiceModules(servicePlan.modulesJson),
    totalModuleMinutes: servicePlan.totalModuleMinutes,
    revision: servicePlan.revision,
    updatedAt: servicePlan.updatedAt.toISOString(),
    updatedBy: servicePlan.updatedByUserId ?? "SYSTEM"
  };
}

export async function listDriverTasks(
  driverId: string
): Promise<DriverTaskV2[]> {
  const assignments = await prisma.assignment.findMany({
    where: {
      driverId,
      sequenceNo: { in: [1, 2, 3] },
      currentForOrders: {
        some: {
          executionStatus: { in: ["PLANNED", "EN_ROUTE", "IN_SERVICE"] }
        }
      }
    },
    orderBy: { sequenceNo: "asc" },
    select: {
      id: true,
      orderId: true,
      sequenceNo: true,
      lockType: true,
      plannedPickupAt: true,
      plannedCompleteAt: true,
      order: {
        select: {
          orderNo: true,
          type: true,
          executionStatus: true,
          feasibility: true,
          promisedPickupAt: true,
          pickupLat: true,
          pickupLng: true,
          deliveryLat: true,
          deliveryLng: true,
          pickupAddress: true,
          deliveryAddress: true
        }
      },
      servicePlan: {
        select: {
          modulesJson: true,
          totalModuleMinutes: true,
          revision: true,
          updatedAt: true,
          updatedByUserId: true
        }
      }
    }
  });

  return assignments.map((assignment) => {
    const pickupPoint = point(
      assignment.order.pickupLat,
      assignment.order.pickupLng
    );
    const deliveryPoint = point(
      assignment.order.deliveryLat,
      assignment.order.deliveryLng
    );
    const pickupAddress = displayText(assignment.order.pickupAddress);
    const deliveryAddress = displayText(assignment.order.deliveryAddress);
    const servicePlan = servicePlanView(assignment.id, assignment.servicePlan);

    return {
      id: assignment.id,
      orderId: assignment.orderId,
      orderNo: assignment.order.orderNo,
      businessType: assignment.order.type,
      executionStatus: assignment.order
        .executionStatus as DriverTaskV2["executionStatus"],
      slot: slotFromSequence(assignment.sequenceNo),
      lockType: assignment.lockType,
      feasibility: assignment.order.feasibility,
      promisedPickupAt: assignment.order.promisedPickupAt.toISOString(),
      ...(assignment.plannedPickupAt
        ? { plannedPickupAt: assignment.plannedPickupAt.toISOString() }
        : {}),
      ...(assignment.plannedCompleteAt
        ? { plannedCompleteAt: assignment.plannedCompleteAt.toISOString() }
        : {}),
      ...(pickupPoint ? { pickupPoint } : {}),
      ...(deliveryPoint ? { deliveryPoint } : {}),
      ...(pickupAddress ? { pickupAddress } : {}),
      ...(deliveryAddress ? { deliveryAddress } : {}),
      servicePlan
    };
  });
}

export async function listUnassignedOrders(): Promise<
  DriverOrderMarkerViewV2[]
> {
  const orders = await prisma.order.findMany({
    where: { executionStatus: "UNASSIGNED", currentAssignmentId: null },
    orderBy: [{ promisedPickupAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderNo: true,
      type: true,
      executionStatus: true,
      feasibility: true,
      promisedPickupAt: true,
      pickupLat: true,
      pickupLng: true,
      deliveryLat: true,
      deliveryLng: true,
      pickupAddress: true,
      deliveryAddress: true
    }
  });

  return orders.map((order) => {
    const pickupPoint = point(order.pickupLat, order.pickupLng);
    const deliveryPoint = point(order.deliveryLat, order.deliveryLng);
    const pickupAddress = displayText(order.pickupAddress);
    const deliveryAddress = displayText(order.deliveryAddress);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      businessType: order.type,
      executionStatus: "UNASSIGNED",
      slot: "NONE",
      lockType: "NONE",
      feasibility: order.feasibility,
      promisedPickupAt: order.promisedPickupAt.toISOString(),
      ...(pickupPoint ? { pickupPoint } : {}),
      ...(deliveryPoint ? { deliveryPoint } : {}),
      ...(pickupAddress ? { pickupAddress } : {}),
      ...(deliveryAddress ? { deliveryAddress } : {})
    };
  });
}

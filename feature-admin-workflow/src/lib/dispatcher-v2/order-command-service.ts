import { randomUUID } from "node:crypto";

import type { OrderExecutionStatus, Prisma } from "@prisma/client";

import { createApiErrorV2 } from "@/lib/contracts/v2";
import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import type { ApiErrorV2 } from "@/types/v2";

type CommandResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorV2 };

type HeldLock = { resourceKey: string; token: string };

export type UpdateOrderResult = CommandResult<{
  orderId: string;
  planVersion?: number;
  replayed: boolean;
}>;

export type CancelOrderResult = CommandResult<{
  orderId: string;
  assignmentId?: string;
  driverId?: string;
  planVersion?: number;
  replayed: boolean;
}>;

const log = createLogger("dispatcher-order-commands-v2");

async function acquireCommandLocks(resourceKeys: string[]) {
  const resources = [...new Set(resourceKeys)].sort().map((resourceKey) => ({
    resourceKey,
    token: randomUUID(),
    ttlSeconds: 15
  }));
  const results = await acquireResourceLocks(resources);
  if ([...results.values()].includes("busy")) {
    return { busy: true, heldLocks: [] as HeldLock[] };
  }
  const allAcquired =
    results.size === resources.length &&
    resources.every(({ resourceKey }) => results.get(resourceKey) === "acquired");
  return {
    busy: false,
    heldLocks: allAcquired
      ? resources.map(({ resourceKey, token }) => ({ resourceKey, token }))
      : []
  };
}

async function releaseCommandLocks(locks: HeldLock[]) {
  for (const lock of [...locks].reverse()) {
    await releaseResourceLock(lock.resourceKey, lock.token);
  }
}

async function processEventBestEffort(eventId: string, traceId: string) {
  try {
    await processInternalEvent(eventId);
  } catch (error) {
    log.error("dispatcher_order_event_processing_failed", {
      eventId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function illegalTransition(
  currentStatus: OrderExecutionStatus,
  targetStatus: OrderExecutionStatus,
  message: string
) {
  return createApiErrorV2("ILLEGAL_TRANSITION", message, {
    currentStatus,
    targetStatus
  });
}

export async function updateOrder(params: {
  orderId: string;
  promisedPickupAt?: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  reason: string;
  operatorUserId: string;
  traceId: string;
}): Promise<UpdateOrderResult> {
  const preflight = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: {
      currentAssignment: { select: { id: true, driverId: true } }
    }
  });
  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Order not found")
    };
  }

  const preflightDriverId = preflight.currentAssignment?.driverId;
  const locks = await acquireCommandLocks([
    `order:lock:${params.orderId}`,
    ...(preflightDriverId ? [`dispatch:lock:${preflightDriverId}`] : [])
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another order operation is in progress"
      )
    };
  }

  const commandEventId = `order-updated:${params.orderId}:${randomUUID()}`;

  try {
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: UpdateOrderResult & { success: true }; eventId: string }
      | { kind: "replayed"; data: UpdateOrderResult & { success: true } }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      if (preflightDriverId) {
        await tx.$queryRaw`
          SELECT "id" FROM "Driver"
          WHERE "id" = ${preflightDriverId}
          FOR UPDATE
        `;
      }
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${params.orderId}
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: { id: params.orderId },
        include: {
          currentAssignment: {
            select: { id: true, driverId: true, status: true }
          }
        }
      });
      if (!order) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Order not found")
        };
      }
      if (order.currentAssignment?.driverId !== preflightDriverId) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Order assignment changed; refresh and retry"
          )
        };
      }
      if (["COMPLETED", "CANCELLED"].includes(order.executionStatus)) {
        return {
          kind: "rejected",
          error: illegalTransition(
            order.executionStatus,
            order.executionStatus,
            "Terminal orders cannot be modified"
          )
        };
      }

      const nextPromisedPickupAt = params.promisedPickupAt
        ? new Date(params.promisedPickupAt)
        : order.promisedPickupAt;
      const nextPickupAddress = params.pickupAddress ?? order.pickupAddress;
      const nextDeliveryAddress =
        params.deliveryAddress ?? order.deliveryAddress;
      const changed =
        nextPromisedPickupAt.getTime() !== order.promisedPickupAt.getTime() ||
        nextPickupAddress !== order.pickupAddress ||
        nextDeliveryAddress !== order.deliveryAddress;

      let currentPlanVersion: number | undefined;
      if (preflightDriverId) {
        const driver = await tx.driver.findUnique({
          where: { id: preflightDriverId },
          select: { planVersion: true }
        });
        if (!driver) {
          return {
            kind: "rejected",
            error: createApiErrorV2("INTERNAL_ERROR", "Assigned driver not found")
          };
        }
        currentPlanVersion = driver.planVersion;
      }

      if (!changed) {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: {
              orderId: order.id,
              planVersion: currentPlanVersion,
              replayed: true
            }
          }
        };
      }

      const updateData: Prisma.OrderUpdateInput = {
        promisedPickupAt: nextPromisedPickupAt,
        pickupAddress: nextPickupAddress,
        deliveryAddress: nextDeliveryAddress,
        feasibility: "UNKNOWN",
        slackMinutes: null
      };
      if (params.pickupAddress !== undefined) {
        updateData.pickupLat = null;
        updateData.pickupLng = null;
      }
      if (params.deliveryAddress !== undefined) {
        updateData.deliveryLat = null;
        updateData.deliveryLng = null;
      }
      await tx.order.update({ where: { id: order.id }, data: updateData });

      const nextPlanVersion =
        currentPlanVersion === undefined ? undefined : currentPlanVersion + 1;
      if (preflightDriverId && nextPlanVersion !== undefined) {
        await tx.driver.update({
          where: { id: preflightDriverId },
          data: { planVersion: nextPlanVersion }
        });
      }

      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: order.id,
          action: "ORDER_MODIFY",
          operatorUserId: params.operatorUserId,
          orderId: order.id,
          driverId: preflightDriverId,
          assignmentId: order.currentAssignment?.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            before: {
              promisedPickupAt: order.promisedPickupAt.toISOString(),
              pickupAddress: order.pickupAddress,
              deliveryAddress: order.deliveryAddress
            },
            after: {
              promisedPickupAt: nextPromisedPickupAt.toISOString(),
              pickupAddress: nextPickupAddress,
              deliveryAddress: nextDeliveryAddress
            },
            previousPlanVersion: currentPlanVersion ?? null,
            nextPlanVersion: nextPlanVersion ?? null
          }
        }
      });

      const occurredAt = new Date();
      const eventId = commandEventId;
      await enqueueInternalEvent(tx, {
        eventId,
        type: "ORDER_UPDATED",
        orderId: order.id,
        driverId: preflightDriverId,
        assignmentId: order.currentAssignment?.id,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });

      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            orderId: order.id,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }
    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(transactionResult.eventId, params.traceId);
    }
    return transactionResult.data;
  } catch (error) {
    log.error("dispatcher_order_update_failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Order update failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

export async function cancelOrder(params: {
  orderId: string;
  reason: string;
  operatorUserId: string;
  traceId: string;
}): Promise<CancelOrderResult> {
  const preflight = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: {
      currentAssignment: { select: { id: true, driverId: true } }
    }
  });
  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Order not found")
    };
  }
  const preflightAssignment = preflight.currentAssignment;
  const locks = await acquireCommandLocks([
    `order:lock:${params.orderId}`,
    ...(preflightAssignment
      ? [`dispatch:lock:${preflightAssignment.driverId}`]
      : [])
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another order operation is in progress"
      )
    };
  }

  try {
    const transactionResult = await prisma.$transaction<
      | { kind: "success"; data: CancelOrderResult & { success: true }; eventId: string }
      | { kind: "replayed"; data: CancelOrderResult & { success: true } }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      if (preflightAssignment) {
        await tx.$queryRaw`
          SELECT "id" FROM "Driver"
          WHERE "id" = ${preflightAssignment.driverId}
          FOR UPDATE
        `;
      }
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${params.orderId}
        FOR UPDATE
      `;
      if (preflightAssignment) {
        await tx.$queryRaw`
          SELECT "id" FROM "Assignment"
          WHERE "id" = ${preflightAssignment.id}
          FOR UPDATE
        `;
      }

      const order = await tx.order.findUnique({
        where: { id: params.orderId },
        include: {
          currentAssignment: {
            select: { id: true, driverId: true, status: true }
          }
        }
      });
      if (!order) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Order not found")
        };
      }
      if (order.executionStatus === "CANCELLED") {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: { orderId: order.id, replayed: true }
          }
        };
      }
      if (
        order.currentAssignment?.id !== preflightAssignment?.id ||
        order.currentAssignment?.driverId !== preflightAssignment?.driverId
      ) {
        return {
          kind: "rejected",
          error: createApiErrorV2(
            "DUPLICATE_OPERATION",
            "Order assignment changed; refresh and retry"
          )
        };
      }
      if (
        order.executionStatus === "IN_SERVICE" ||
        order.executionStatus === "COMPLETED"
      ) {
        return {
          kind: "rejected",
          error: illegalTransition(
            order.executionStatus,
            "CANCELLED",
            "Order cannot be cancelled after service has started"
          )
        };
      }

      let nextPlanVersion: number | undefined;
      if (preflightAssignment) {
        const driver = await tx.driver.findUnique({
          where: { id: preflightAssignment.driverId },
          select: { planVersion: true }
        });
        if (!driver) {
          return {
            kind: "rejected",
            error: createApiErrorV2("INTERNAL_ERROR", "Assigned driver not found")
          };
        }
        nextPlanVersion = driver.planVersion + 1;
        if (
          order.currentAssignment &&
          ["ACTIVE", "ACCEPTED"].includes(order.currentAssignment.status)
        ) {
          await tx.assignment.update({
            where: { id: order.currentAssignment.id },
            data: { status: "CANCELLED", sequenceNo: null, lockType: "NONE" }
          });
        }
      }

      const occurredAt = new Date();
      await tx.order.update({
        where: { id: order.id },
        data: {
          executionStatus: "CANCELLED",
          status: "CANCELLED",
          cancelledAt: occurredAt,
          currentAssignmentId: null
        }
      });
      await tx.dispatchAlert.updateMany({
        where: { orderId: order.id, status: "OPEN" },
        data: {
          status: "RESOLVED",
          resolvedAt: occurredAt,
          resolvedBy: "ORDER_CANCELLED"
        }
      });
      if (preflightAssignment && nextPlanVersion !== undefined) {
        await tx.driver.update({
          where: { id: preflightAssignment.driverId },
          data: { status: "S1", planVersion: nextPlanVersion }
        });
      }
      await tx.operationLog.create({
        data: {
          entityType: "ORDER",
          entityId: order.id,
          action: "CANCEL",
          operatorUserId: params.operatorUserId,
          orderId: order.id,
          driverId: preflightAssignment?.driverId,
          assignmentId: preflightAssignment?.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            beforeExecutionStatus: order.executionStatus,
            afterExecutionStatus: "CANCELLED",
            releasedAssignmentId: preflightAssignment?.id ?? null,
            nextPlanVersion: nextPlanVersion ?? null
          }
        }
      });

      const eventId = `order-cancelled:${order.id}`;
      await enqueueInternalEvent(tx, {
        eventId,
        type: "ORDER_CANCELLED",
        orderId: order.id,
        driverId: preflightAssignment?.driverId,
        assignmentId: preflightAssignment?.id,
        occurredAt: occurredAt.toISOString(),
        traceId: params.traceId
      });

      return {
        kind: "success",
        eventId,
        data: {
          success: true,
          data: {
            orderId: order.id,
            assignmentId: preflightAssignment?.id,
            driverId: preflightAssignment?.driverId,
            planVersion: nextPlanVersion,
            replayed: false
          }
        }
      };
    });

    if (transactionResult.kind === "rejected") {
      return { success: false, error: transactionResult.error };
    }
    if (transactionResult.kind === "success") {
      await releaseCommandLocks(locks.heldLocks);
      locks.heldLocks.length = 0;
      await processEventBestEffort(transactionResult.eventId, params.traceId);
    }
    return transactionResult.data;
  } catch (error) {
    log.error("dispatcher_order_cancel_failed", {
      orderId: params.orderId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Order cancellation failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

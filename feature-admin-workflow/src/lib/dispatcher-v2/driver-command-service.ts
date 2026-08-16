import { randomUUID } from "node:crypto";

import { createApiErrorV2 } from "@/lib/contracts/v2";
import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import type { ApiErrorV2, DriverAvailabilityV2 } from "@/types/v2";

type CommandResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorV2 };

type HeldLock = { resourceKey: string; token: string };

export type SetDriverAvailabilityResult = CommandResult<{
  driverId: string;
  availability: DriverAvailabilityV2;
  planVersion: number;
  releasedAssignmentIds: string[];
  replayed: boolean;
}>;

const log = createLogger("dispatcher-driver-commands-v2");

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
    log.error("driver_availability_event_processing_failed", {
      eventId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function setDriverAvailability(params: {
  driverId: string;
  availability: DriverAvailabilityV2;
  reason: string;
  operatorUserId: string;
  traceId: string;
}): Promise<SetDriverAvailabilityResult> {
  const preflight = await prisma.driver.findFirst({
    where: { id: params.driverId, isActive: true },
    select: {
      id: true,
      assignments: {
        where: {
          status: { in: ["ACTIVE", "ACCEPTED"] },
          order: { executionStatus: "PLANNED" }
        },
        select: { orderId: true }
      }
    }
  });
  if (!preflight) {
    return {
      success: false,
      error: createApiErrorV2("NOT_FOUND", "Driver not found")
    };
  }

  const locks = await acquireCommandLocks([
    `dispatch:lock:${params.driverId}`,
    ...preflight.assignments.map(
      (assignment) => `order:lock:${assignment.orderId}`
    )
  ]);
  if (locks.busy) {
    return {
      success: false,
      error: createApiErrorV2(
        "DUPLICATE_OPERATION",
        "Another driver operation is in progress"
      )
    };
  }

  try {
    const transactionResult = await prisma.$transaction<
      | {
          kind: "success";
          data: SetDriverAvailabilityResult & { success: true };
          eventIds: string[];
        }
      | {
          kind: "replayed";
          data: SetDriverAvailabilityResult & { success: true };
        }
      | { kind: "rejected"; error: ApiErrorV2 }
    >(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver"
        WHERE "id" = ${params.driverId}
        FOR UPDATE
      `;
      const driver = await tx.driver.findFirst({
        where: { id: params.driverId, isActive: true },
        select: {
          id: true,
          availability: true,
          planVersion: true,
          assignments: {
            where: {
              status: { in: ["ACTIVE", "ACCEPTED"] },
              order: { executionStatus: "PLANNED" }
            },
            select: {
              id: true,
              orderId: true,
              order: { select: { currentAssignmentId: true } }
            }
          }
        }
      });
      if (!driver) {
        return {
          kind: "rejected",
          error: createApiErrorV2("NOT_FOUND", "Driver not found")
        };
      }
      if (driver.availability === params.availability) {
        return {
          kind: "replayed",
          data: {
            success: true,
            data: {
              driverId: driver.id,
              availability: driver.availability,
              planVersion: driver.planVersion,
              releasedAssignmentIds: [],
              replayed: true
            }
          }
        };
      }

      const releasable =
        params.availability === "UNAVAILABLE"
          ? driver.assignments.filter(
              (assignment) =>
                assignment.order.currentAssignmentId === assignment.id
            )
          : [];
      for (const orderId of [...new Set(releasable.map((item) => item.orderId))].sort()) {
        await tx.$queryRaw`
          SELECT "id" FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;
      }

      const occurredAt = new Date();
      for (const assignment of releasable) {
        await tx.assignment.update({
          where: { id: assignment.id },
          data: {
            status: "RECYCLED",
            recycledAt: occurredAt,
            sequenceNo: null,
            lockType: "NONE"
          }
        });
        await tx.order.update({
          where: { id: assignment.orderId },
          data: {
            executionStatus: "UNASSIGNED",
            status: "PENDING",
            currentAssignmentId: null
          }
        });
        await tx.operationLog.create({
          data: {
            entityType: "ASSIGNMENT",
            entityId: assignment.id,
            action: "RECYCLE",
            operatorUserId: params.operatorUserId,
            orderId: assignment.orderId,
            driverId: driver.id,
            assignmentId: assignment.id,
            traceId: params.traceId,
            reason: params.reason,
            metadataJson: {
              trigger: "DRIVER_UNAVAILABLE",
              beforeExecutionStatus: "PLANNED",
              afterExecutionStatus: "UNASSIGNED"
            }
          }
        });
      }

      const nextPlanVersion = driver.planVersion + 1;
      await tx.driver.update({
        where: { id: driver.id },
        data: {
          availability: params.availability,
          planVersion: nextPlanVersion
        }
      });
      await tx.operationLog.create({
        data: {
          entityType: "DRIVER",
          entityId: driver.id,
          action: "AVAILABILITY_CHANGE",
          operatorUserId: params.operatorUserId,
          driverId: driver.id,
          traceId: params.traceId,
          reason: params.reason,
          metadataJson: {
            beforeAvailability: driver.availability,
            afterAvailability: params.availability,
            releasedAssignmentIds: releasable.map((item) => item.id),
            previousPlanVersion: driver.planVersion,
            nextPlanVersion
          }
        }
      });

      const eventIds: string[] = [];
      if (releasable.length === 0) {
        const eventId = `driver-availability:${driver.id}:${nextPlanVersion}`;
        await enqueueInternalEvent(tx, {
          eventId,
          type: "DRIVER_AVAILABILITY_CHANGED",
          driverId: driver.id,
          occurredAt: occurredAt.toISOString(),
          traceId: params.traceId
        });
        eventIds.push(eventId);
      } else {
        for (const assignment of releasable) {
          const eventId = `driver-availability:${driver.id}:${nextPlanVersion}:${assignment.id}`;
          await enqueueInternalEvent(tx, {
            eventId,
            type: "DRIVER_AVAILABILITY_CHANGED",
            orderId: assignment.orderId,
            driverId: driver.id,
            assignmentId: assignment.id,
            occurredAt: occurredAt.toISOString(),
            traceId: params.traceId
          });
          eventIds.push(eventId);
        }
      }

      return {
        kind: "success",
        eventIds,
        data: {
          success: true,
          data: {
            driverId: driver.id,
            availability: params.availability,
            planVersion: nextPlanVersion,
            releasedAssignmentIds: releasable.map((item) => item.id),
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
      for (const eventId of transactionResult.eventIds) {
        await processEventBestEffort(eventId, params.traceId);
      }
    }
    return transactionResult.data;
  } catch (error) {
    log.error("driver_availability_change_failed", {
      driverId: params.driverId,
      availability: params.availability,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Driver availability change failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocks(locks.heldLocks);
  }
}

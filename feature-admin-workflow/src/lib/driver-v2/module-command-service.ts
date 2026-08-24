import { randomUUID } from "node:crypto";

import type { OrderExecutionStatus, Prisma } from "@prisma/client";

import { createApiErrorV2 } from "@/lib/contracts/v2";
import { sumServiceModuleMinutes } from "@/lib/contracts/v2/service-modules";
import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import type {
  ApiErrorV2,
  ServiceModuleV2,
  ServicePlanV2
} from "@/types/v2";

import {
  normalizeServiceModules,
  parseStoredServiceModules
} from "./service-modules";
import type { DriverModuleUpdateDataV2 } from "./types";

type CommandResult =
  | { success: true; data: DriverModuleUpdateDataV2 }
  | { success: false; error: ApiErrorV2 };

type HeldLock = { resourceKey: string; token: string };

const log = createLogger("driver-module-command-v2");
const activeStatuses = new Set<OrderExecutionStatus>([
  "PLANNED",
  "EN_ROUTE",
  "IN_SERVICE"
]);

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
  const allAcquired = resources.every(
    ({ resourceKey }) => results.get(resourceKey) === "acquired"
  );
  return {
    busy: false,
    heldLocks: allAcquired
      ? resources.map(({ resourceKey, token }) => ({ resourceKey, token }))
      : []
  };
}

async function releaseCommandLocks(heldLocks: HeldLock[]) {
  for (const lock of [...heldLocks].reverse()) {
    await releaseResourceLock(lock.resourceKey, lock.token);
  }
}

async function releaseCommandLocksBestEffort(
  heldLocks: HeldLock[],
  traceId: string
) {
  try {
    await releaseCommandLocks(heldLocks);
  } catch (error) {
    log.error("driver_module_lock_release_failed", {
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    heldLocks.length = 0;
  }
}

function sameModules(left: ServiceModuleV2[], right: ServiceModuleV2[]) {
  return (
    left.length === right.length &&
    left.every((module, index) => module === right[index])
  );
}

function mapServicePlan(plan: {
  assignmentId: string;
  modulesJson: Prisma.JsonValue;
  totalModuleMinutes: number;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string | null;
}): ServicePlanV2 {
  return {
    assignmentId: plan.assignmentId,
    modules: parseStoredServiceModules(plan.modulesJson),
    totalModuleMinutes: plan.totalModuleMinutes,
    revision: plan.revision,
    updatedAt: plan.updatedAt.toISOString(),
    updatedBy: plan.updatedByUserId ?? "SYSTEM"
  };
}

function invalidTaskState(currentStatus: OrderExecutionStatus) {
  return createApiErrorV2(
    "ILLEGAL_TRANSITION",
    "Service modules can only be changed for the current active assignment",
    { currentStatus, targetStatus: currentStatus }
  );
}

async function processEventBestEffort(eventId: string, traceId: string) {
  try {
    await processInternalEvent(eventId);
  } catch (error) {
    log.error("driver_module_event_processing_failed", {
      eventId,
      traceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function updateDriverServiceModules(params: {
  assignmentId: string;
  driverId: string;
  modules: ServiceModuleV2[];
  traceId: string;
}): Promise<CommandResult> {
  const modules = normalizeServiceModules(params.modules);
  const heldLocks: HeldLock[] = [];

  try {
    const preflight = await prisma.assignment.findUnique({
      where: { id: params.assignmentId },
      select: { driverId: true, orderId: true }
    });
    if (!preflight) {
      return {
        success: false,
        error: createApiErrorV2("NOT_FOUND", "Assignment not found")
      };
    }
    if (preflight.driverId !== params.driverId) {
      return {
        success: false,
        error: createApiErrorV2(
          "FORBIDDEN",
          "Drivers may only operate their own assignments"
        )
      };
    }

    const locks = await acquireCommandLocks([
      `dispatch:lock:${params.driverId}`,
      `order:lock:${preflight.orderId}`
    ]);
    if (locks.busy) {
      return {
        success: false,
        error: createApiErrorV2(
          "DUPLICATE_OPERATION",
          "Another assignment operation is in progress"
        )
      };
    }
    heldLocks.push(...locks.heldLocks);

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Driver"
        WHERE "id" = ${params.driverId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${preflight.orderId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "Assignment"
        WHERE "id" = ${params.assignmentId}
        FOR UPDATE
      `;

      const assignment = await tx.assignment.findUnique({
        where: { id: params.assignmentId },
        include: {
          driver: { select: { planVersion: true } },
          order: {
            select: { currentAssignmentId: true, executionStatus: true }
          },
          servicePlan: true
        }
      });
      if (!assignment) {
        return {
          kind: "rejected" as const,
          error: createApiErrorV2("NOT_FOUND", "Assignment not found")
        };
      }
      if (assignment.driverId !== params.driverId) {
        return {
          kind: "rejected" as const,
          error: createApiErrorV2(
            "FORBIDDEN",
            "Drivers may only operate their own assignments"
          )
        };
      }
      if (
        assignment.order.currentAssignmentId !== assignment.id ||
        !activeStatuses.has(assignment.order.executionStatus)
      ) {
        return {
          kind: "rejected" as const,
          error: invalidTaskState(assignment.order.executionStatus)
        };
      }

      const operator = await tx.user.findUnique({
        where: { driverId: params.driverId },
        select: { id: true }
      });
      if (!operator) {
        return {
          kind: "rejected" as const,
          error: createApiErrorV2(
            "INTERNAL_ERROR",
            "No bound driver user is available for audit logging"
          )
        };
      }

      const previousModules = parseStoredServiceModules(
        assignment.servicePlan?.modulesJson
      );
      if (sameModules(previousModules, modules)) {
        return {
          kind: "replayed" as const,
          data: {
            servicePlan: assignment.servicePlan
              ? mapServicePlan(assignment.servicePlan)
              : null,
            planVersion: assignment.driver.planVersion,
            replayed: true
          }
        };
      }

      const nextPlanVersion = assignment.driver.planVersion + 1;
      const plan = await tx.orderServicePlan.upsert({
        where: { assignmentId: assignment.id },
        create: {
          assignmentId: assignment.id,
          modulesJson: modules,
          totalModuleMinutes: sumServiceModuleMinutes(modules),
          revision: 1,
          updatedByUserId: operator.id
        },
        update: {
          modulesJson: modules,
          totalModuleMinutes: sumServiceModuleMinutes(modules),
          revision: { increment: 1 },
          updatedByUserId: operator.id
        }
      });
      await tx.driver.update({
        where: { id: params.driverId },
        data: { planVersion: nextPlanVersion }
      });
      await tx.operationLog.create({
        data: {
          entityType: "SERVICE_PLAN",
          entityId: plan.id,
          action: "MODULE_CHANGE",
          operatorUserId: operator.id,
          orderId: assignment.orderId,
          driverId: params.driverId,
          assignmentId: assignment.id,
          traceId: params.traceId,
          reason: "Driver changed service modules",
          metadataJson: {
            before: {
              modules: previousModules,
              planVersion: assignment.driver.planVersion
            },
            after: { modules, planVersion: nextPlanVersion }
          }
        }
      });

      const eventId = `service-plan:${assignment.id}:revision:${plan.revision}`;
      await enqueueInternalEvent(tx, {
        eventId,
        type: "MODULE_CHANGE_APPLIED",
        orderId: assignment.orderId,
        driverId: params.driverId,
        assignmentId: assignment.id,
        occurredAt: plan.updatedAt.toISOString(),
        traceId: params.traceId
      });
      return {
        kind: "success" as const,
        eventId,
        data: {
          servicePlan: mapServicePlan(plan),
          planVersion: nextPlanVersion,
          replayed: false
        }
      };
    });

    if (outcome.kind === "rejected") {
      return { success: false, error: outcome.error };
    }
    if (outcome.kind === "success") {
      await releaseCommandLocksBestEffort(heldLocks, params.traceId);
      await processEventBestEffort(outcome.eventId, params.traceId);
    }
    return { success: true, data: outcome.data };
  } catch (error) {
    log.error("driver_module_update_failed", {
      assignmentId: params.assignmentId,
      driverId: params.driverId,
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: createApiErrorV2(
        "INTERNAL_ERROR",
        "Service module update failed; no partial change was committed"
      )
    };
  } finally {
    await releaseCommandLocksBestEffort(heldLocks, params.traceId);
  }
}

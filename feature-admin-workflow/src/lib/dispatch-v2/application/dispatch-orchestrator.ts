import { randomUUID } from "crypto";

import type { DispatchEventV2 } from "@/types/v2";

import { createLogger } from "@/lib/logger";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import { runDispatchV2 } from "../core";
import { buildDispatchSnapshot } from "./dispatch-snapshot-service";
import { buildEtaMatrix } from "./eta-matrix-service";
import {
  commitDispatchPlan,
  STALE_DISPATCH_SNAPSHOT,
  type DispatchCommitResult
} from "./dispatch-plan-committer";

const log = createLogger("dispatch-v2-orchestrator");
const MAX_SNAPSHOT_ATTEMPTS = 3;

export async function runDispatchApplication(
  event: DispatchEventV2,
  traceId: string
): Promise<DispatchCommitResult> {
  for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt++) {
    const snapshot = await buildDispatchSnapshot(event);
    const etaResolver = await buildEtaMatrix(snapshot);
    const output = runDispatchV2(snapshot, etaResolver);

    const resources = [
      ...snapshot.drivers.map((driver) => ({
        resourceKey: `dispatch:lock:${driver.driverId}`,
        token: randomUUID(),
        ttlSeconds: 15
      })),
      ...snapshot.orders.map((order) => ({
        resourceKey: `order:lock:${order.orderId}`,
        token: randomUUID(),
        ttlSeconds: 15
      }))
    ];
    const lockResults = await acquireResourceLocks(resources);
    const busy = [...lockResults.values()].some((result) => result === "busy");
    const acquired = resources.filter(
      (resource) => lockResults.get(resource.resourceKey) === "acquired"
    );

    if (busy) {
      throw new Error("DISPATCH_RESOURCE_BUSY");
    }

    try {
      const result = await commitDispatchPlan(snapshot, output, traceId);
      log.info("dispatch_plan_committed", {
        traceId,
        eventType: event.type,
        attempt,
        changedDrivers: result.changedDriverIds.length,
        releasedAssignments: result.releasedAssignments,
        createdAssignments: result.createdAssignments
      });
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === STALE_DISPATCH_SNAPSHOT &&
        attempt < MAX_SNAPSHOT_ATTEMPTS
      ) {
        log.warn("dispatch_snapshot_stale_retrying", {
          traceId,
          eventType: event.type,
          attempt
        });
        continue;
      }
      throw error;
    } finally {
      for (const resource of acquired.reverse()) {
        await releaseResourceLock(resource.resourceKey, resource.token);
      }
    }
  }

  throw new Error(STALE_DISPATCH_SNAPSHOT);
}

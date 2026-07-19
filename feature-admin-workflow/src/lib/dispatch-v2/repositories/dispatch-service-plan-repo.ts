import { prisma } from "@/lib/prisma";
import type { ServicePlanRow } from "./types";

/**
 * Batch-read service plan module minutes for the given assignment IDs.
 *
 * Returns a flat list — callers build a map keyed by assignmentId.
 * Assignments without a plan entry default to 0 module minutes.
 */
export async function findServicePlans(params: {
  assignmentIds: string[];
}): Promise<ServicePlanRow[]> {
  const { assignmentIds } = params;

  if (assignmentIds.length === 0) return [];

  const rows = await prisma.orderServicePlan.findMany({
    where: {
      assignmentId: { in: assignmentIds },
    },
    select: {
      assignmentId: true,
      totalModuleMinutes: true,
    },
  });

  return rows.map((r) => ({
    assignmentId: r.assignmentId,
    totalModuleMinutes: r.totalModuleMinutes,
  }));
}

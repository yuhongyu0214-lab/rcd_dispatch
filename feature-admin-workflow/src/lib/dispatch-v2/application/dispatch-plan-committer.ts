import type { Prisma } from "@prisma/client";

import type {
  DispatchInputV2,
  DispatchOutputV2,
  DispatchPlannedAssignmentV2,
  OrderFeasibilityV2
} from "@/types/v2";

import { SYSTEM_ROLES } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export const STALE_DISPATCH_SNAPSHOT = "STALE_DISPATCH_SNAPSHOT";

type DriverChange = {
  driverId: string;
  expectedPlanVersion: number;
  releasedAssignmentIds: string[];
  newAssignments: DispatchPlannedAssignmentV2[];
};

export type DispatchCommitResult = {
  changedDriverIds: string[];
  releasedAssignments: number;
  createdAssignments: number;
};

function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function sameInstant(
  persisted: Date | null,
  planned: string | undefined
): boolean {
  const persistedMs = persisted?.getTime() ?? null;
  const plannedMs = toDate(planned)?.getTime() ?? null;
  return persistedMs === plannedMs;
}

function sameLogicalPlan(
  current: {
    id: string;
    orderId: string;
    driverId: string;
    status: string;
    lockType: string;
    sequenceNo: number | null;
    plannedDepartAt: Date | null;
    plannedPickupAt: Date | null;
    plannedCompleteAt: Date | null;
    deadheadEtaMinutes: number | null;
    serviceEtaMinutes: number | null;
    etaUnavailableReason: string | null;
    order: {
      executionStatus: string;
      currentAssignmentId: string | null;
    };
  },
  planned: DispatchPlannedAssignmentV2,
  driverId: string
): boolean {
  return (
    current.orderId === planned.orderId &&
    current.driverId === driverId &&
    (current.status === "ACTIVE" || current.status === "ACCEPTED") &&
    current.lockType === "NONE" &&
    current.order.executionStatus === "PLANNED" &&
    current.order.currentAssignmentId === current.id &&
    current.sequenceNo === planned.sequenceNo &&
    sameInstant(current.plannedDepartAt, planned.plannedDepartAt) &&
    sameInstant(current.plannedPickupAt, planned.plannedPickupAt) &&
    sameInstant(current.plannedCompleteAt, planned.plannedCompleteAt) &&
    current.deadheadEtaMinutes === (planned.deadheadEtaMinutes ?? null) &&
    current.serviceEtaMinutes === (planned.serviceEtaMinutes ?? null) &&
    current.etaUnavailableReason ===
      (planned.etaAvailable
        ? null
        : (planned.etaUnavailableReason ?? null))
  );
}

function feasibilityFor(
  evaluation: DispatchOutputV2["evaluations"][number]
): OrderFeasibilityV2 {
  if (evaluation.result === "INFEASIBLE") return "INFEASIBLE";
  if (evaluation.result === "PLANNED") {
    return evaluation.bestSlackMinutes >= 10 ? "NORMAL" : "AT_RISK";
  }
  return "UNKNOWN";
}

function buildDriverChanges(
  snapshot: DispatchInputV2,
  output: DispatchOutputV2
): DriverChange[] {
  const driverMap = new Map(
    snapshot.drivers.map((driver) => [driver.driverId, driver])
  );
  const newOrderIds = new Set<string>();
  const changes: DriverChange[] = [];

  for (const proposal of output.proposals) {
    const driver = driverMap.get(proposal.driverId);
    if (!driver) throw new Error(STALE_DISPATCH_SNAPSHOT);

    const keptIds = new Set(
      proposal.assignments
        .map((assignment) => assignment.assignmentId)
        .filter((id): id is string => id !== null)
    );
    const released = driver.assignments.filter(
      (assignment) =>
        assignment.assignmentId !== null &&
        !keptIds.has(assignment.assignmentId)
    );

    for (const assignment of released) {
      if (
        assignment.executionStatus !== "PLANNED" ||
        assignment.lockType !== "NONE"
      ) {
        throw new Error(
          `Protected assignment ${assignment.assignmentId} was removed from a proposal`
        );
      }
    }

    const newAssignments = proposal.assignments.filter(
      (assignment) => assignment.assignmentId === null
    );
    for (const assignment of newAssignments) {
      if (newOrderIds.has(assignment.orderId)) {
        throw new Error(
          `Order ${assignment.orderId} appears in more than one new assignment`
        );
      }
      newOrderIds.add(assignment.orderId);
    }

    if (released.length > 0 || newAssignments.length > 0) {
      changes.push({
        driverId: proposal.driverId,
        expectedPlanVersion: proposal.expectedPlanVersion,
        releasedAssignmentIds: released.map(
          (assignment) => assignment.assignmentId as string
        ),
        newAssignments
      });
    }
  }

  return changes;
}

async function lockRows(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  driverIds: string[]
) {
  for (const orderId of [...new Set(orderIds)].sort()) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "Order"
      WHERE "id" = ${orderId}
      FOR UPDATE
    `;
  }
  for (const driverId of [...new Set(driverIds)].sort()) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "Driver"
      WHERE "id" = ${driverId}
      FOR UPDATE
    `;
  }
}

async function reconcileIdenticalPlans(
  tx: Prisma.TransactionClient,
  changes: DriverChange[]
): Promise<DriverChange[]> {
  const reconciled: DriverChange[] = [];

  for (const change of changes) {
    const remainingNewAssignments = [...change.newAssignments];
    const remainingReleasedAssignmentIds: string[] = [];

    for (const assignmentId of change.releasedAssignmentIds) {
      const current = await tx.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          orderId: true,
          driverId: true,
          status: true,
          lockType: true,
          sequenceNo: true,
          plannedDepartAt: true,
          plannedPickupAt: true,
          plannedCompleteAt: true,
          deadheadEtaMinutes: true,
          serviceEtaMinutes: true,
          etaUnavailableReason: true,
          order: {
            select: {
              executionStatus: true,
              currentAssignmentId: true
            }
          }
        }
      });
      if (!current || current.driverId !== change.driverId) {
        throw new Error(STALE_DISPATCH_SNAPSHOT);
      }

      const replacementIndex = remainingNewAssignments.findIndex(
        (planned) =>
          planned.orderId === current.orderId &&
          sameLogicalPlan(current, planned, change.driverId)
      );
      if (replacementIndex >= 0) {
        remainingNewAssignments.splice(replacementIndex, 1);
      } else {
        remainingReleasedAssignmentIds.push(assignmentId);
      }
    }

    if (
      remainingReleasedAssignmentIds.length > 0 ||
      remainingNewAssignments.length > 0
    ) {
      reconciled.push({
        ...change,
        releasedAssignmentIds: remainingReleasedAssignmentIds,
        newAssignments: remainingNewAssignments
      });
    }
  }

  return reconciled;
}

export async function commitDispatchPlan(
  snapshot: DispatchInputV2,
  output: DispatchOutputV2,
  traceId: string
): Promise<DispatchCommitResult> {
  const proposedChanges = buildDriverChanges(snapshot, output);
  const proposedDriverIds = proposedChanges.map((change) => change.driverId);
  const evaluationMap = new Map(
    output.evaluations.map((evaluation) => [evaluation.orderId, evaluation])
  );
  const affectedOrderIds = [
    ...snapshot.orders.map((order) => order.orderId),
    ...proposedChanges.flatMap((change) =>
      change.newAssignments.map((assignment) => assignment.orderId)
    )
  ];

  return prisma.$transaction(
    async (tx) => {
      await lockRows(tx, affectedOrderIds, proposedDriverIds);

      if (proposedChanges.length > 0) {
        const currentDrivers = await tx.driver.findMany({
          where: { id: { in: proposedDriverIds } },
          select: { id: true, planVersion: true }
        });
        const currentVersionMap = new Map(
          currentDrivers.map((driver) => [driver.id, driver.planVersion])
        );
        for (const change of proposedChanges) {
          if (
            currentVersionMap.get(change.driverId) !==
            change.expectedPlanVersion
          ) {
            throw new Error(STALE_DISPATCH_SNAPSHOT);
          }
        }
      }

      const changes = await reconcileIdenticalPlans(tx, proposedChanges);
      const changedDriverIds = changes.map((change) => change.driverId);

      const operator = await tx.user.findFirst({
        where: { role: { in: [...SYSTEM_ROLES] } },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });
      if ((changes.length > 0 || output.evaluations.length > 0) && !operator) {
        throw new Error("SYSTEM_OPERATOR_NOT_CONFIGURED");
      }

      let releasedAssignments = 0;
      let createdAssignments = 0;
      const releasedServicePlans = new Map<
        string,
        {
          modulesJson: Prisma.JsonValue;
          totalModuleMinutes: number;
          revision: number;
          updatedByUserId: string | null;
          updatedAt: Date;
        }
      >();

      for (const change of changes) {
        for (const assignmentId of change.releasedAssignmentIds) {
          const assignment = await tx.assignment.findUnique({
            where: { id: assignmentId },
            select: {
              id: true,
              orderId: true,
              driverId: true,
              servicePlan: {
                select: {
                  modulesJson: true,
                  totalModuleMinutes: true,
                  revision: true,
                  updatedByUserId: true,
                  updatedAt: true
                }
              }
            }
          });
          if (!assignment || assignment.driverId !== change.driverId) {
            throw new Error(STALE_DISPATCH_SNAPSHOT);
          }

          const release = await tx.assignment.updateMany({
            where: {
              id: assignment.id,
              status: { in: ["ACTIVE", "ACCEPTED"] },
              lockType: "NONE",
              order: { executionStatus: "PLANNED" }
            },
            data: {
              status: "RECYCLED",
              recycledAt: new Date(output.calculatedAt),
              sequenceNo: null,
              lockType: "NONE"
            }
          });
          if (release.count !== 1) throw new Error(STALE_DISPATCH_SNAPSHOT);

          const detach = await tx.order.updateMany({
            where: {
              id: assignment.orderId,
              executionStatus: "PLANNED",
              currentAssignmentId: assignment.id
            },
            data: {
              executionStatus: "UNASSIGNED",
              status: "PENDING",
              currentAssignmentId: null
            }
          });
          if (detach.count !== 1) throw new Error(STALE_DISPATCH_SNAPSHOT);

          if (assignment.servicePlan) {
            releasedServicePlans.set(
              assignment.orderId,
              assignment.servicePlan
            );
          }

          releasedAssignments += 1;
          await tx.operationLog.create({
            data: {
              entityType: "ASSIGNMENT",
              entityId: assignment.id,
              action: "RECYCLE",
              operatorUserId: operator!.id,
              orderId: assignment.orderId,
              driverId: change.driverId,
              assignmentId: assignment.id,
              traceId,
              reason: "V2 automatic replanning released a mutable assignment",
              metadataJson: {
                trigger: snapshot.event.type,
                expectedPlanVersion: change.expectedPlanVersion
              }
            }
          });
        }
      }

      for (const change of changes) {
        for (const planned of change.newAssignments) {
          const evaluation = evaluationMap.get(planned.orderId);
          const assignment = await tx.assignment.create({
            data: {
              orderId: planned.orderId,
              driverId: change.driverId,
              type: "RECOMMEND_ASSIGN",
              status: "ACTIVE",
              createdByUserId: operator!.id,
              sequenceNo: planned.sequenceNo,
              plannedDepartAt: toDate(planned.plannedDepartAt),
              plannedPickupAt: toDate(planned.plannedPickupAt),
              plannedCompleteAt: toDate(planned.plannedCompleteAt),
              deadheadEtaMinutes: planned.deadheadEtaMinutes ?? null,
              serviceEtaMinutes: planned.serviceEtaMinutes ?? null,
              etaUnavailableReason: planned.etaAvailable
                ? null
                : planned.etaUnavailableReason,
              lastEtaCalculatedAt: new Date(output.calculatedAt),
              lockType: "NONE"
            }
          });
          const releasedServicePlan = releasedServicePlans.get(
            planned.orderId
          );
          if (releasedServicePlan) {
            await tx.orderServicePlan.create({
              data: {
                assignmentId: assignment.id,
                modulesJson: (releasedServicePlan.modulesJson ??
                  []) as Prisma.InputJsonValue,
                totalModuleMinutes:
                  releasedServicePlan.totalModuleMinutes,
                revision: releasedServicePlan.revision,
                updatedByUserId: releasedServicePlan.updatedByUserId,
                updatedAt: releasedServicePlan.updatedAt
              }
            });
          }

          const attach = await tx.order.updateMany({
            where: {
              id: planned.orderId,
              executionStatus: "UNASSIGNED",
              currentAssignmentId: null
            },
            data: {
              executionStatus: "PLANNED",
              status: "ASSIGNED",
              currentAssignmentId: assignment.id,
              feasibility: evaluation ? feasibilityFor(evaluation) : "UNKNOWN",
              slackMinutes: evaluation?.bestSlackMinutes ?? null
            }
          });
          if (attach.count !== 1) throw new Error(STALE_DISPATCH_SNAPSHOT);

          createdAssignments += 1;
          await tx.operationLog.create({
            data: {
              entityType: "ASSIGNMENT",
              entityId: assignment.id,
              action: "AUTO_DISPATCH",
              operatorUserId: operator!.id,
              orderId: planned.orderId,
              driverId: change.driverId,
              assignmentId: assignment.id,
              traceId,
              reason: "V2 automatic dispatch plan committed",
              metadataJson: {
                trigger: snapshot.event.type,
                sequenceNo: planned.sequenceNo,
                expectedPlanVersion: change.expectedPlanVersion,
                etaAvailable: planned.etaAvailable
              }
            }
          });
        }
      }

      for (const evaluation of output.evaluations) {
        const feasibility = feasibilityFor(evaluation);
        await tx.order.updateMany({
          where: {
            id: evaluation.orderId,
            executionStatus: { notIn: ["COMPLETED", "CANCELLED"] }
          },
          data: {
            feasibility,
            slackMinutes: evaluation.bestSlackMinutes
          }
        });

        if (feasibility === "INFEASIBLE") {
          const openAlert = await tx.dispatchAlert.findFirst({
            where: { orderId: evaluation.orderId, status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: { id: true }
          });
          if (openAlert) {
            await tx.dispatchAlert.update({
              where: { id: openAlert.id },
              data: {
                slackMinutesAtCreate: evaluation.bestSlackMinutes as number
              }
            });
          } else {
            await tx.dispatchAlert.create({
              data: {
                orderId: evaluation.orderId,
                type: "INFEASIBLE",
                status: "OPEN",
                slackMinutesAtCreate: evaluation.bestSlackMinutes as number
              }
            });
          }
        } else if (evaluation.result === "PLANNED") {
          await tx.dispatchAlert.updateMany({
            where: { orderId: evaluation.orderId, status: "OPEN" },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(output.calculatedAt),
              resolvedBy: "SYSTEM_RECALC"
            }
          });
        }
      }

      for (const change of changes) {
        await tx.driver.update({
          where: { id: change.driverId },
          data: { planVersion: change.expectedPlanVersion + 1 }
        });
      }

      return {
        changedDriverIds,
        releasedAssignments,
        createdAssignments
      };
    },
    { timeout: 10_000 }
  );
}

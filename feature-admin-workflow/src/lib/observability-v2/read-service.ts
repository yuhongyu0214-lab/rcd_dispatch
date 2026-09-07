import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  OPERATION_LOG_CHANGE_FIELDS_V2,
  type DispatchAlertV2,
  type OperationActionV2,
  type OperationLogChangeFieldV2,
  type OperationLogChangeV2,
  type OperationLogV2,
  type OperationLogValueV2,
  type PageResultV2
} from "@/types/v2";

export type ObservabilityPaginationV2 = {
  page: number;
  pageSize: number;
};

export type AlertListFiltersV2 = ObservabilityPaginationV2 & {
  status?: "OPEN" | "RESOLVED";
};

export type OperationLogListFiltersV2 = ObservabilityPaginationV2 & {
  orderId?: string;
  driverId?: string;
  traceId?: string;
  action?: OperationActionV2;
};

const OPERATION_LOG_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  reason: true,
  traceId: true,
  orderId: true,
  driverId: true,
  assignmentId: true,
  metadataJson: true,
  createdAt: true,
  operatorUser: { select: { id: true, name: true } }
} satisfies Prisma.OperationLogSelect;

type OperationLogRow = Prisma.OperationLogGetPayload<{
  select: typeof OPERATION_LOG_SELECT;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPublicValue(value: unknown): value is OperationLogValueV2 {
  return isScalar(value) || (Array.isArray(value) && value.every(isScalar));
}

function hasOwn(record: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function valuesEqual(left: OperationLogValueV2, right: OperationLogValueV2) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return Object.is(left, right);
  }
  return (
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  );
}

function readPair(
  before: JsonRecord | null,
  after: JsonRecord | null,
  field: string
): Pick<OperationLogChangeV2, "before" | "after"> | null {
  const hasBefore = before !== null && hasOwn(before, field);
  const hasAfter = after !== null && hasOwn(after, field);
  if (!hasBefore && !hasAfter) return null;

  const beforeValue = hasBefore ? before![field] : null;
  const afterValue = hasAfter ? after![field] : null;
  if (!isPublicValue(beforeValue) || !isPublicValue(afterValue)) return null;
  if (valuesEqual(beforeValue, afterValue)) return null;
  return { before: beforeValue, after: afterValue };
}

function readAliasedPair(
  metadata: JsonRecord,
  beforeKey: string,
  afterKey: string
) {
  const hasBefore = hasOwn(metadata, beforeKey);
  const hasAfter = hasOwn(metadata, afterKey);
  if (!hasBefore && !hasAfter) return null;
  const before = hasBefore ? metadata[beforeKey] : null;
  const after = hasAfter ? metadata[afterKey] : null;
  if (!isPublicValue(before) || !isPublicValue(after)) return null;
  if (valuesEqual(before, after)) return null;
  return { before, after };
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const FIELD_ALIASES: Partial<
  Record<OperationLogChangeFieldV2, ReadonlyArray<readonly [string, string]>>
> = {
  driverId: [["fromDriverId", "toDriverId"]],
  executionStatus: [
    ["beforeExecutionStatus", "afterExecutionStatus"],
    ["fromExecutionStatus", "toExecutionStatus"]
  ],
  lockType: [["beforeLockType", "afterLockType"]],
  modules: [["beforeModules", "afterModules"]],
  planVersion: [
    ["previousPlanVersion", "nextPlanVersion"],
    ["expectedPlanVersion", "nextPlanVersion"]
  ],
  sourceVersion: [["beforeVersion", "afterVersion"]]
};

const CREATION_CHANGE_FIELDS_BY_ACTION: Readonly<
  Partial<Record<OperationActionV2, readonly OperationLogChangeFieldV2[]>>
> = {
  IMPORT: ["executionStatus", "sourceVersion"],
  ASSIGN: ["driverId", "lockType", "sequenceNo"],
  AUTO_DISPATCH: ["driverId", "sequenceNo"],
  CANCEL: ["cancelledAt", "executionStatus", "sourceVersion"]
};

function isApprovedCreationChange(
  action: OperationActionV2,
  field: OperationLogChangeFieldV2
) {
  return CREATION_CHANGE_FIELDS_BY_ACTION[action]?.includes(field) ?? false;
}

function mapPlanVersionPair(metadata: JsonRecord) {
  const keys = [
    "expectedFromPlanVersion",
    "expectedToPlanVersion",
    "nextFromPlanVersion",
    "nextToPlanVersion"
  ] as const;
  if (!keys.every((key) => hasOwn(metadata, key))) return null;
  const values = keys.map((key) => metadata[key]);
  if (!values.every(isScalar)) return null;
  const before: OperationLogValueV2 = [values[0], values[1]];
  const after: OperationLogValueV2 = [values[2], values[3]];
  return valuesEqual(before, after) ? null : { before, after };
}

function mapChange(
  row: OperationLogRow,
  metadata: JsonRecord,
  field: OperationLogChangeFieldV2
): OperationLogChangeV2 | null {
  const nestedBefore = isRecord(metadata.before) ? metadata.before : null;
  const nestedAfter = isRecord(metadata.after) ? metadata.after : null;
  const nestedPair = readPair(nestedBefore, nestedAfter, field);
  if (nestedPair) return { field, ...nestedPair };

  if (field === "planVersion") {
    const aggregatePair = mapPlanVersionPair(metadata);
    if (aggregatePair) return { field, ...aggregatePair };
  }

  const conventionalPair = readAliasedPair(
    metadata,
    `before${capitalize(field)}`,
    `after${capitalize(field)}`
  );
  if (conventionalPair) return { field, ...conventionalPair };

  for (const [beforeKey, afterKey] of FIELD_ALIASES[field] ?? []) {
    const pair = readAliasedPair(metadata, beforeKey, afterKey);
    if (pair) return { field, ...pair };
  }

  if (
    isApprovedCreationChange(row.action, field) &&
    hasOwn(metadata, field) &&
    isPublicValue(metadata[field])
  ) {
    const after = metadata[field];
    if (!valuesEqual(null, after)) return { field, before: null, after };
  }

  if (
    field === "driverId" &&
    row.driverId &&
    (row.action === "ASSIGN" || row.action === "AUTO_DISPATCH")
  ) {
    return { field, before: null, after: row.driverId };
  }

  return null;
}

export function mapOperationLogChanges(
  row: OperationLogRow
): OperationLogChangeV2[] {
  if (!isRecord(row.metadataJson)) return [];
  return OPERATION_LOG_CHANGE_FIELDS_V2.flatMap((field) => {
    const change = mapChange(row, row.metadataJson as JsonRecord, field);
    return change ? [change] : [];
  });
}

function mapOperationLog(row: OperationLogRow): OperationLogV2 {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    operator: row.operatorUser,
    reason: row.reason,
    traceId: row.traceId,
    ...(row.orderId ? { orderId: row.orderId } : {}),
    ...(row.driverId ? { driverId: row.driverId } : {}),
    ...(row.assignmentId ? { assignmentId: row.assignmentId } : {}),
    changes: mapOperationLogChanges(row),
    createdAt: row.createdAt.toISOString()
  };
}

export async function listAlerts(
  filters: AlertListFiltersV2
): Promise<PageResultV2<DispatchAlertV2>> {
  const where: Prisma.DispatchAlertWhereInput = { status: filters.status };
  const [total, rows] = await Promise.all([
    prisma.dispatchAlert.count({ where }),
    prisma.dispatchAlert.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize
    })
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      type: row.type,
      status: row.status,
      slackMinutesAtCreate: row.slackMinutesAtCreate,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString(),
      resolvedBy: row.resolvedBy ?? undefined,
      historyRetained: true
    })),
    total,
    page: filters.page,
    pageSize: filters.pageSize
  };
}

export async function listOperationLogs(
  filters: OperationLogListFiltersV2
): Promise<PageResultV2<OperationLogV2>> {
  const where: Prisma.OperationLogWhereInput = {
    orderId: filters.orderId,
    driverId: filters.driverId,
    traceId: filters.traceId,
    action: filters.action
  };
  const [total, rows] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      select: OPERATION_LOG_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize
    })
  ]);

  return {
    items: rows.map(mapOperationLog),
    total,
    page: filters.page,
    pageSize: filters.pageSize
  };
}

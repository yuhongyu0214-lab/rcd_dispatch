import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  compareSourceVersions,
  V1_MIGRATION_SOURCE_VERSION
} from "@/lib/contracts/v2/source-version";

import type {
  CanonicalOrderV2,
  IngestRecordResultV2
} from "@/types/v2";

const log = createLogger("order-source");

type PrismaTx = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Prisma P2002 唯一约束冲突 */
function isP2002(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** 解析操作用户（系统用户或管理员） */
async function resolveOperatorUser(tx: PrismaTx): Promise<string | null> {
  const user = await tx.user.findFirst({
    where: { role: "system" },
    select: { id: true }
  });
  if (user) return user.id;

  const admin = await tx.user.findFirst({
    where: { role: "admin" },
    select: { id: true }
  });
  if (admin) return admin.id;

  return null;
}

function buildOrderDbData(
  canonical: CanonicalOrderV2,
  storeId: string
): Prisma.OrderCreateInput {
  return {
    orderNo: canonical.orderNo,
    type: canonical.businessType as "STORE_PICKUP" | "STORE_RETURN" | "DOOR_DELIVERY" | "DOOR_PICKUP",
    sourceSystem: canonical.sourceSystem as "HALUO" | "PLUGIN" | "API" | "V1_IMPORT",
    externalOrderId: canonical.externalOrderId,
    sourceVersion: canonical.sourceVersion,
    executionStatus: canonical.cancelledAt ? "CANCELLED" : "UNASSIGNED",
    status: canonical.cancelledAt ? "CANCELLED" : "PENDING",
    store: { connect: { id: storeId } },
    licensePlateSnapshot: canonical.licensePlateSnapshot ?? null,
    vehicleTypeSnapshot: canonical.vehicleTypeSnapshot ?? null,
    pickupAddress: canonical.pickupAddress,
    pickupLat: canonical.pickupLat ?? null,
    pickupLng: canonical.pickupLng ?? null,
    returnAddress: canonical.deliveryAddress,
    deliveryAddress: canonical.deliveryAddress,
    deliveryLat: canonical.deliveryLat ?? null,
    deliveryLng: canonical.deliveryLng ?? null,
    returnLat: canonical.deliveryLat ?? null,
    returnLng: canonical.deliveryLng ?? null,
    scheduledAt: new Date(canonical.promisedPickupAt),
    promisedPickupAt: new Date(canonical.promisedPickupAt),
    receivedAt: new Date(canonical.receivedAt),
    remark: canonical.remark ?? null,
    cancelledAt: canonical.cancelledAt ? new Date(canonical.cancelledAt) : null
  };
}

function buildOrderUpdateData(
  canonical: CanonicalOrderV2,
  storeId: string
): Prisma.OrderUpdateInput {
  return {
    orderNo: canonical.orderNo,
    type: canonical.businessType as "STORE_PICKUP" | "STORE_RETURN" | "DOOR_DELIVERY" | "DOOR_PICKUP",
    sourceVersion: canonical.sourceVersion,
    store: { connect: { id: storeId } },
    licensePlateSnapshot: canonical.licensePlateSnapshot ?? null,
    vehicleTypeSnapshot: canonical.vehicleTypeSnapshot ?? null,
    pickupAddress: canonical.pickupAddress,
    pickupLat: canonical.pickupLat ?? null,
    pickupLng: canonical.pickupLng ?? null,
    returnAddress: canonical.deliveryAddress,
    deliveryAddress: canonical.deliveryAddress,
    deliveryLat: canonical.deliveryLat ?? null,
    deliveryLng: canonical.deliveryLng ?? null,
    returnLat: canonical.deliveryLat ?? null,
    returnLng: canonical.deliveryLng ?? null,
    scheduledAt: new Date(canonical.promisedPickupAt),
    promisedPickupAt: new Date(canonical.promisedPickupAt),
    receivedAt: new Date(canonical.receivedAt),
    remark: canonical.remark ?? null,
    cancelledAt: canonical.cancelledAt ? new Date(canonical.cancelledAt) : null
  };
}

type EventResult = "SUCCESS" | "SKIPPED" | "FAILED" | "MIGRATED";

function buildEventPayloadSummary(canonical: CanonicalOrderV2): Record<string, string | number | boolean | null> {
  return {
    orderNo: canonical.orderNo,
    businessType: canonical.businessType,
    promisedPickupAt: canonical.promisedPickupAt,
    cancelledAt: canonical.cancelledAt ?? null,
    storeCode: canonical.storeCode
  };
}

async function upsertSourceEvent(
  tx: PrismaTx,
  params: {
    orderId: string | null;
    sourceSystem: string;
    externalOrderId: string;
    sourceVersion: string;
    sourceStatusRaw: string;
    result: EventResult;
    reason: string | null;
    payloadSummary: Record<string, string | number | boolean | null>;
    traceId: string;
    receivedAt: string;
    processedAt: Date;
  }
) {
  return tx.orderSourceEvent.upsert({
    where: {
      sourceSystem_externalOrderId_sourceVersion: {
        sourceSystem: params.sourceSystem as "HALUO" | "PLUGIN" | "API" | "V1_IMPORT",
        externalOrderId: params.externalOrderId,
        sourceVersion: params.sourceVersion
      }
    },
    create: {
      orderId: params.orderId,
      sourceSystem: params.sourceSystem as "HALUO" | "PLUGIN" | "API" | "V1_IMPORT",
      externalOrderId: params.externalOrderId,
      sourceVersion: params.sourceVersion,
      sourceStatusRaw: params.sourceStatusRaw,
      result: params.result as "SUCCESS" | "SKIPPED" | "FAILED" | "MIGRATED",
      reason: params.reason,
      payloadSummary: params.payloadSummary,
      traceId: params.traceId,
      receivedAt: new Date(params.receivedAt),
      processedAt: params.processedAt
    },
    update: {
      orderId: params.orderId,
      sourceStatusRaw: params.sourceStatusRaw,
      result: params.result as "SUCCESS" | "SKIPPED" | "FAILED" | "MIGRATED",
      reason: params.reason,
      payloadSummary: params.payloadSummary,
      traceId: params.traceId,
      processedAt: params.processedAt
    }
  });
}

async function writeOperationLog(
  tx: PrismaTx,
  params: {
    entityType: "ORDER";
    entityId: string;
    action: "IMPORT" | "CANCEL" | "ORDER_MODIFY";
    traceId: string;
    reason: string;
    metadataJson: Record<string, string | boolean | null>;
  }
) {
  const operatorUserId = await resolveOperatorUser(tx);
  if (!operatorUserId) {
    log.warn("未找到操作人用户，跳过 OperationLog", {
      traceId: params.traceId,
      entityId: params.entityId
    });
    return;
  }

  await tx.operationLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      operatorUserId,
      orderId: params.entityId,
      traceId: params.traceId,
      reason: params.reason,
      metadataJson: params.metadataJson
    }
  });
}

interface IngestTransactionResult {
  orderId: string | null;
  eventResult: "success" | "skipped" | "failed";
  reason?: string;
  replayed?: boolean;
}

async function executeIngestTransaction(
  canonical: CanonicalOrderV2,
  traceId: string,
  retry: boolean
): Promise<IngestTransactionResult> {
  return prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as PrismaTx;

    // 1. 查找已有 OrderSourceEvent（幂等性 key）
    const existingEvent = await txClient.orderSourceEvent.findUnique({
      where: {
        sourceSystem_externalOrderId_sourceVersion: {
          sourceSystem: canonical.sourceSystem as "HALUO" | "PLUGIN" | "API" | "V1_IMPORT",
          externalOrderId: canonical.externalOrderId,
          sourceVersion: canonical.sourceVersion
        }
      }
    });

    // 如果已有事件且不是 FAILED（可重试），直接返回 replay
    if (existingEvent && existingEvent.result !== "FAILED") {
      const statusMap: Record<string, IngestTransactionResult["eventResult"]> = {
        SUCCESS: "success",
        SKIPPED: "skipped",
        MIGRATED: "success"
      };
      return {
        orderId: existingEvent.orderId,
        eventResult: statusMap[existingEvent.result] ?? "skipped",
        reason: existingEvent.reason ?? undefined,
        replayed: true
      };
    }

    // 2. 查找已有 Order
    const existingOrder = await txClient.order.findUnique({
      where: {
        sourceSystem_externalOrderId: {
          sourceSystem: canonical.sourceSystem as "HALUO" | "PLUGIN" | "API" | "V1_IMPORT",
          externalOrderId: canonical.externalOrderId
        }
      }
    });

    // 3. 版本比较
    const isNewer = !existingOrder
      ? true // 新订单，视为更新版本
      : compareSourceVersions(canonical.sourceVersion, existingOrder.sourceVersion) > 0;

    const isEqual = existingOrder
      ? compareSourceVersions(canonical.sourceVersion, existingOrder.sourceVersion) === 0
      : false;

    const isStale = existingOrder && !isNewer && !isEqual;

    // 4. 如果已存在同版本事件且为 FAILED → 重试
    const canRetry = existingEvent?.result === "FAILED" || !existingEvent;

    // 5. 旧版本 → 只写 source event (SKIPPED/STALE_VERSION)
    if (isStale) {
      const summary = buildEventPayloadSummary(canonical);
      await upsertSourceEvent(txClient, {
        orderId: existingOrder!.id,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        sourceStatusRaw: canonical.sourceStatusRaw,
        result: "SKIPPED",
        reason: "STALE_VERSION",
        payloadSummary: summary,
        traceId,
        receivedAt: canonical.receivedAt,
        processedAt: new Date()
      });

      return {
        orderId: existingOrder!.id,
        eventResult: "skipped",
        reason: "STALE_VERSION"
      };
    }

    // 6. 解析门店
    const store = await txClient.store.findUnique({
      where: { code: canonical.storeCode },
      select: { id: true }
    });

    if (!store && !existingOrder) {
      // 新建订单但门店不存在 → FAILED event
      const summary = buildEventPayloadSummary(canonical);
      await upsertSourceEvent(txClient, {
        orderId: null,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        sourceStatusRaw: canonical.sourceStatusRaw,
        result: "FAILED",
        reason: "STORE_NOT_FOUND",
        payloadSummary: summary,
        traceId,
        receivedAt: canonical.receivedAt,
        processedAt: new Date()
      });

      return {
        orderId: null,
        eventResult: "failed",
        reason: "STORE_NOT_FOUND"
      };
    }

    // 如果门店不存在但已有订单 → 使用已有订单的 storeId
    const storeId = store?.id ?? "";
    if (!store && existingOrder) {
      // 门店不存在，无法更新订单的 storeId -> 跳过更新但记录事件
      const summary = buildEventPayloadSummary(canonical);
      await upsertSourceEvent(txClient, {
        orderId: existingOrder.id,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        sourceStatusRaw: canonical.sourceStatusRaw,
        result: "FAILED",
        reason: "STORE_NOT_FOUND",
        payloadSummary: summary,
        traceId,
        receivedAt: canonical.receivedAt,
        processedAt: new Date()
      });

      return {
        orderId: existingOrder.id,
        eventResult: "failed",
        reason: "STORE_NOT_FOUND"
      };
    }

    // 7. 取消逻辑
    if (canonical.cancelledAt) {
      return handleCancel(txClient, canonical, existingOrder, storeId, traceId);
    }

    // 8. 新建或更新订单
    let orderId: string;
    let afterVersion: string = canonical.sourceVersion;
    let afterExecutionStatus: string;

    if (!existingOrder) {
      // 新建
      const orderData = buildOrderDbData(canonical, storeId);
      const newOrder = await txClient.order.create({ data: orderData });
      orderId = newOrder.id;
      afterExecutionStatus = newOrder.executionStatus;

      const summary = buildEventPayloadSummary(canonical);
      await upsertSourceEvent(txClient, {
        orderId,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        sourceStatusRaw: canonical.sourceStatusRaw,
        result: "SUCCESS",
        reason: null,
        payloadSummary: summary,
        traceId,
        receivedAt: canonical.receivedAt,
        processedAt: new Date()
      });

      await writeOperationLog(txClient, {
        entityType: "ORDER",
        entityId: orderId,
        action: "IMPORT",
        traceId,
        reason: `来源入单创建: ${canonical.sourceSystem}/${canonical.externalOrderId}`,
        metadataJson: {
          sourceSystem: canonical.sourceSystem,
          externalOrderId: canonical.externalOrderId,
          sourceVersion: canonical.sourceVersion,
          executionStatus: afterExecutionStatus
        }
      });

      return { orderId, eventResult: "success" };
    }

    // 更新
    const beforeVersion = existingOrder.sourceVersion;
    const beforeExecutionStatus = existingOrder.executionStatus;

    const updateData = buildOrderUpdateData(canonical, storeId);
    updateData.executionStatus = "UNASSIGNED" as const;
    updateData.status = "PENDING" as const;
    // preserve assignment if exists
    // Preserve existing assignment; Prisma handles this by omission

    await txClient.order.update({
      where: { id: existingOrder.id },
      data: updateData
    });

    orderId = existingOrder.id;
    afterExecutionStatus = "UNASSIGNED";

    const summary = {
      ...buildEventPayloadSummary(canonical),
      beforeVersion,
      afterVersion,
      beforeExecutionStatus,
      afterExecutionStatus
    };
    await upsertSourceEvent(txClient, {
      orderId,
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      sourceStatusRaw: canonical.sourceStatusRaw,
      result: "SUCCESS",
      reason: null,
      payloadSummary: summary,
      traceId,
      receivedAt: canonical.receivedAt,
      processedAt: new Date()
    });

    await writeOperationLog(txClient, {
      entityType: "ORDER",
      entityId: orderId,
      action: "ORDER_MODIFY",
      traceId,
      reason: `来源版本更新: ${beforeVersion} → ${afterVersion}`,
      metadataJson: {
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        beforeVersion,
        afterVersion,
        beforeExecutionStatus,
        afterExecutionStatus
      }
    });

    return { orderId, eventResult: "success" };
  });
}

async function handleCancel(
  txClient: PrismaTx,
  canonical: CanonicalOrderV2,
  existingOrder: { id: string; executionStatus: string; currentAssignmentId: string | null; sourceVersion: string } | null,
  storeId: string,
  traceId: string
): Promise<IngestTransactionResult> {
  const summary = buildEventPayloadSummary(canonical);

  if (!existingOrder) {
    // 新建即取消
    const orderData = buildOrderDbData(canonical, storeId);
    const newOrder = await txClient.order.create({ data: orderData });

    await upsertSourceEvent(txClient, {
      orderId: newOrder.id,
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      sourceStatusRaw: canonical.sourceStatusRaw,
      result: "SUCCESS",
      reason: null,
      payloadSummary: summary,
      traceId,
      receivedAt: canonical.receivedAt,
      processedAt: new Date()
    });

    await writeOperationLog(txClient, {
      entityType: "ORDER",
      entityId: newOrder.id,
      action: "CANCEL",
      traceId,
      reason: `来源入单创建即取消: ${canonical.sourceSystem}/${canonical.externalOrderId}`,
      metadataJson: {
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        executionStatus: "CANCELLED",
        cancelledAt: canonical.cancelledAt!
      }
    });

    return { orderId: newOrder.id, eventResult: "success" };
  }

  const currentStatus = existingOrder.executionStatus;

  // 已取消的订单 → 同版本 replay
  if (currentStatus === "CANCELLED") {
    // 更新快照
    const updateData = buildOrderUpdateData(canonical, storeId);
    updateData.executionStatus = "CANCELLED" as const;
    updateData.status = "CANCELLED" as const;
    // Preserve existing assignment; Prisma handles this by omission

    await txClient.order.update({
      where: { id: existingOrder.id },
      data: updateData
    });

    await upsertSourceEvent(txClient, {
      orderId: existingOrder.id,
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      sourceStatusRaw: canonical.sourceStatusRaw,
      result: "SUCCESS",
      reason: null,
      payloadSummary: {
        ...summary,
        beforeVersion: existingOrder.sourceVersion,
        afterVersion: canonical.sourceVersion,
        beforeExecutionStatus: "CANCELLED",
        afterExecutionStatus: "CANCELLED"
      },
      traceId,
      receivedAt: canonical.receivedAt,
      processedAt: new Date()
    });

    return { orderId: existingOrder.id, eventResult: "success" };
  }

  // IN_SERVICE / COMPLETED → FOLLOW_UP_REQUIRED
  if (currentStatus === "IN_SERVICE" || currentStatus === "COMPLETED") {
    const updateData = buildOrderUpdateData(canonical, storeId);
    // 不改变 executionStatus 和 status
    // Preserve existing assignment; Prisma handles this by omission

    await txClient.order.update({
      where: { id: existingOrder.id },
      data: updateData
    });

    await upsertSourceEvent(txClient, {
      orderId: existingOrder.id,
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      sourceStatusRaw: canonical.sourceStatusRaw,
      result: "SUCCESS",
      reason: "FOLLOW_UP_REQUIRED",
      payloadSummary: {
        ...summary,
        beforeVersion: existingOrder.sourceVersion,
        afterVersion: canonical.sourceVersion,
        beforeExecutionStatus: currentStatus,
        afterExecutionStatus: currentStatus
      },
      traceId,
      receivedAt: canonical.receivedAt,
      processedAt: new Date()
    });

    await writeOperationLog(txClient, {
      entityType: "ORDER",
      entityId: existingOrder.id,
      action: "ORDER_MODIFY",
      traceId,
      reason: `来源取消但订单 IN_SERVICE/COMPLETED 需人工跟进: ${canonical.sourceSystem}/${canonical.externalOrderId}`,
      metadataJson: {
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        beforeVersion: existingOrder.sourceVersion,
        afterVersion: canonical.sourceVersion,
        executionStatus: currentStatus,
        followUpRequired: true
      }
    });

    return { orderId: existingOrder.id, eventResult: "success", reason: "FOLLOW_UP_REQUIRED" };
  }

  // UNASSIGNED / PLANNED / EN_ROUTE → 正常取消
  const updateData = buildOrderUpdateData(canonical, storeId);
  updateData.executionStatus = "CANCELLED" as const;
  updateData.status = "CANCELLED" as const;
  // Preserve existing assignment; Prisma handles this by omission

  await txClient.order.update({
    where: { id: existingOrder.id },
    data: updateData
  });

  await upsertSourceEvent(txClient, {
    orderId: existingOrder.id,
    sourceSystem: canonical.sourceSystem,
    externalOrderId: canonical.externalOrderId,
    sourceVersion: canonical.sourceVersion,
    sourceStatusRaw: canonical.sourceStatusRaw,
    result: "SUCCESS",
    reason: null,
    payloadSummary: {
      ...summary,
      beforeVersion: existingOrder.sourceVersion,
      afterVersion: canonical.sourceVersion,
      beforeExecutionStatus: currentStatus,
      afterExecutionStatus: "CANCELLED"
    },
    traceId,
    receivedAt: canonical.receivedAt,
    processedAt: new Date()
  });

  await writeOperationLog(txClient, {
    entityType: "ORDER",
    entityId: existingOrder.id,
    action: "CANCEL",
    traceId,
    reason: `来源取消: ${canonical.sourceSystem}/${canonical.externalOrderId}`,
    metadataJson: {
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId,
      beforeVersion: existingOrder.sourceVersion,
      afterVersion: canonical.sourceVersion,
      beforeExecutionStatus: currentStatus,
      afterExecutionStatus: "CANCELLED"
    }
  });

  return { orderId: existingOrder.id, eventResult: "success" };
}

export async function processIngestRecord(
  canonical: CanonicalOrderV2,
  traceId: string
): Promise<IngestRecordResultV2> {
  try {
    const result = await executeIngestTransaction(canonical, traceId, false);
    return {
      index: 0, // caller fills this
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      status: result.eventResult,
      reason: result.reason as IngestRecordResultV2["reason"],
      replayed: result.replayed,
      traceId
    };
  } catch (error) {
    if (isP2002(error)) {
      // 唯一约束冲突 = 并发重复, 视为 skipped
      log.warn("入单并发冲突（P2002），视为 skipped", {
        traceId,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion
      });
      return {
        index: 0,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        status: "skipped",
        reason: "DUPLICATE",
        replayed: true,
        traceId
      };
    }

    // RangeError from compareSourceVersions → validation failure
    if (error instanceof RangeError) {
      log.error("版本比较异常", {
        traceId,
        error: error.message,
        sourceSystem: canonical.sourceSystem,
        externalOrderId: canonical.externalOrderId
      });
      return {
        index: 0,
        externalOrderId: canonical.externalOrderId,
        sourceVersion: canonical.sourceVersion,
        status: "failed",
        reason: "VALIDATION_FAILED",
        traceId
      };
    }

    log.error("入单处理异常", {
      traceId,
      error: error instanceof Error ? error.message : "unknown",
      sourceSystem: canonical.sourceSystem,
      externalOrderId: canonical.externalOrderId
    });
    return {
      index: 0,
      externalOrderId: canonical.externalOrderId,
      sourceVersion: canonical.sourceVersion,
      status: "failed",
      traceId
    };
  }
}

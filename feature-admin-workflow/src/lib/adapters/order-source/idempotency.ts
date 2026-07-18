import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { compareSourceVersions } from "@/lib/contracts/v2/source-version";

import type {
  CanonicalOrderV2,
  IngestRecordResultV2
} from "@/types/v2";

const log = createLogger("order-source");

/** P0-3: 乐观锁冲突标记，触发事务级重试（重读 + 重新比较版本） */
const VERSION_RACE_ERROR = "VERSION_RACE";
/** 写入竞争（乐观锁命中 0 行 / P2002 唯一键冲突）最大尝试次数（含首次） */
const MAX_WRITE_RACE_ATTEMPTS = 3;

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

/** P0-3: 是否是版本竞争错误（乐观锁 WHERE 命中 0 行） */
function isVersionRace(error: unknown): boolean {
  return error instanceof Error && error.message === VERSION_RACE_ERROR;
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

/**
 * P0-1: 版本更新只允许"元数据"字段 —— 地址/坐标/时间/车辆快照/备注/cancelledAt。
 * 绝不包含 executionStatus / status / currentAssignmentId：
 * Prisma update 对缺失字段保持原值，PLANNED / EN_ROUTE / IN_SERVICE 等执行状态不受影响。
 *
 * 返回 UncheckedUpdateManyInput（标量形式），同时兼容 update / updateMany（P0-3 乐观锁需要 updateMany）。
 */
function buildOrderUpdateData(
  canonical: CanonicalOrderV2,
  storeId: string
): Prisma.OrderUncheckedUpdateManyInput {
  return {
    orderNo: canonical.orderNo,
    type: canonical.businessType as "STORE_PICKUP" | "STORE_RETURN" | "DOOR_DELIVERY" | "DOOR_PICKUP",
    sourceVersion: canonical.sourceVersion,
    storeId,
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

/**
 * P0-3: 带乐观锁的订单更新。
 * WHERE 附带读取时的 sourceVersion；若并发事务已抢先改写版本，命中 0 行，
 * 抛出 VERSION_RACE 让外层回滚事务并重读重试。
 */
async function guardedOrderUpdate(
  tx: PrismaTx,
  orderId: string,
  expectedSourceVersion: string,
  data: Prisma.OrderUncheckedUpdateManyInput
): Promise<void> {
  const result = await tx.order.updateMany({
    where: { id: orderId, sourceVersion: expectedSourceVersion },
    data
  });
  if (result.count === 0) {
    throw new Error(VERSION_RACE_ERROR);
  }
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

/**
 * 所有权边界：1A 只写 ORDER 维度的操作日志（IMPORT / CANCEL / ORDER_MODIFY）。
 * ASSIGNMENT 维度（RECYCLE 等）属于 Gate 3 调度事务，本阶段不落此类日志。
 */
async function writeOperationLog(
  tx: PrismaTx,
  params: {
    entityType: "ORDER";
    entityId: string;
    action: "IMPORT" | "CANCEL" | "ORDER_MODIFY";
    traceId: string;
    reason: string;
    metadataJson: Record<string, string | number | boolean | null>;
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
      driverId: null,
      assignmentId: null,
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
  traceId: string
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

    // P1-1: 已有事件且不是 FAILED（可重试）→ 一律按契约返回 skipped + replayed。
    // 重放（SUCCESS / SKIPPED / MIGRATED）不重复执行任何写入，也不返回 success。
    if (existingEvent && existingEvent.result !== "FAILED") {
      return {
        orderId: existingEvent.orderId,
        eventResult: "skipped",
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

    // 4. 旧版本 → 只写 source event (SKIPPED/STALE_VERSION)
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

    // 5. 解析门店
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

    // 6. 取消逻辑
    if (canonical.cancelledAt) {
      return handleCancel(txClient, canonical, existingOrder, storeId, traceId);
    }

    // 7. 新建或更新订单
    if (!existingOrder) {
      // 新建
      const orderData = buildOrderDbData(canonical, storeId);
      const newOrder = await txClient.order.create({ data: orderData });
      const orderId = newOrder.id;
      const afterExecutionStatus = newOrder.executionStatus;

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

    // 更新 —— P0-1: 仅元数据（地址/坐标/时间/车辆快照/备注），
    // 不改变 executionStatus / status / currentAssignmentId。
    // 订单处于 PLANNED / EN_ROUTE / IN_SERVICE / COMPLETED 时执行状态保持不变。
    const beforeVersion = existingOrder.sourceVersion;
    const beforeExecutionStatus = existingOrder.executionStatus;
    const afterVersion = canonical.sourceVersion;

    const updateData = buildOrderUpdateData(canonical, storeId);

    // P0-3: 乐观锁 —— 并发不同版本写入时，落后的事务命中 0 行并重试
    await guardedOrderUpdate(txClient, existingOrder.id, beforeVersion, updateData);

    const orderId = existingOrder.id;
    const afterExecutionStatus = beforeExecutionStatus;

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

  // 已取消的订单 → 幂等更新快照
  if (currentStatus === "CANCELLED") {
    const updateData = buildOrderUpdateData(canonical, storeId);
    updateData.executionStatus = "CANCELLED";
    updateData.status = "CANCELLED";

    // P0-3: 与其他写入路径一致，带版本乐观锁
    await guardedOrderUpdate(
      txClient,
      existingOrder.id,
      existingOrder.sourceVersion,
      updateData
    );

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

  // IN_SERVICE / COMPLETED → FOLLOW_UP_REQUIRED（仅更新元数据，不改变执行状态）
  if (currentStatus === "IN_SERVICE" || currentStatus === "COMPLETED") {
    const updateData = buildOrderUpdateData(canonical, storeId);

    await guardedOrderUpdate(
      txClient,
      existingOrder.id,
      existingOrder.sourceVersion,
      updateData
    );

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

  // UNASSIGNED / PLANNED / EN_ROUTE → 取消：只落地来源事实与取消意图。
  // 所有权边界（P0 返修，恢复并行设计原分工）：
  // - 1A 在本事务内原子保存订单 CANCELLED 事实（executionStatus / status / cancelledAt）；
  // - currentAssignmentId 保持原值，作为"计划待释放"的取消意图供下游识别
  //   （executionStatus=CANCELLED 且 currentAssignmentId 非空 = 待 Gate 3 释放）；
  // - Assignment 终止、Driver.planVersion 递增、DispatchAlert 解决与重排触发
  //   由 Gate 3 调度事务单一所有者在其并发边界（订单/司机短锁）内统一完成，
  //   1A 不越权写入这些实体。
  const pendingReleaseAssignmentId = existingOrder.currentAssignmentId;

  const updateData = buildOrderUpdateData(canonical, storeId);
  updateData.executionStatus = "CANCELLED";
  updateData.status = "CANCELLED";

  await guardedOrderUpdate(
    txClient,
    existingOrder.id,
    existingOrder.sourceVersion,
    updateData
  );

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
      afterExecutionStatus: "CANCELLED",
      // 取消意图：非空表示计划释放待 Gate 3 处理（本阶段不触碰 Assignment）
      pendingReleaseAssignmentId
    }
  });

  return { orderId: existingOrder.id, eventResult: "success" };
}

export async function processIngestRecord(
  canonical: CanonicalOrderV2,
  traceId: string
): Promise<IngestRecordResultV2> {
  // 写入竞争统一走"回滚整个事务 → 重读 → 重试"（最多 MAX_WRITE_RACE_ATTEMPTS 次）：
  // - P0-3: 乐观锁 WHERE 命中 0 行（并发版本更新）
  // - P0 返修: P2002 唯一键冲突（并发首次建单 / 并发写同一幂等事件）。
  //   P2002 不能直接认定 DUPLICATE —— 首次建单时 v2/v3 并发都判断订单不存在，
  //   v3 撞唯一键后若按重复丢弃，v3 的更新快照将永远丢失。
  //   重新执行事务后重读，自然分流为 replay（同版本事件已存在）、
  //   update（本版本更新）或 stale（本版本已落后）。
  for (let attempt = 1; attempt <= MAX_WRITE_RACE_ATTEMPTS; attempt++) {
    try {
      const result = await executeIngestTransaction(canonical, traceId);
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
      const raceKind = isVersionRace(error)
        ? "VERSION_RACE"
        : isP2002(error)
          ? "P2002"
          : null;

      if (raceKind) {
        if (attempt < MAX_WRITE_RACE_ATTEMPTS) {
          log.warn("入单写入竞争，回滚后重读重试", {
            traceId,
            attempt,
            raceKind,
            sourceSystem: canonical.sourceSystem,
            externalOrderId: canonical.externalOrderId,
            sourceVersion: canonical.sourceVersion
          });
          continue;
        }
        log.error("入单写入竞争重试耗尽", {
          traceId,
          attempts: MAX_WRITE_RACE_ATTEMPTS,
          raceKind,
          sourceSystem: canonical.sourceSystem,
          externalOrderId: canonical.externalOrderId,
          sourceVersion: canonical.sourceVersion
        });
        return {
          index: 0,
          externalOrderId: canonical.externalOrderId,
          sourceVersion: canonical.sourceVersion,
          status: "failed",
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

  // 理论不可达（循环内必然 return），为满足类型检查提供兜底
  return {
    index: 0,
    externalOrderId: canonical.externalOrderId,
    sourceVersion: canonical.sourceVersion,
    status: "failed",
    traceId
  };
}

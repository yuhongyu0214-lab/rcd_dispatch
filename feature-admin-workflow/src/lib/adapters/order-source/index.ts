import type {
  IngestBatchResultV2,
  IngestEnvelopeV2,
  IngestRecordResultV2
} from "@/types/v2";

import { createLogger } from "@/lib/logger";

import { processIngestRecord } from "./idempotency";
import { mapToCanonical } from "./mapper";
import { normalizeRecord } from "./normalize";
import type { IngestContext } from "./types";
import { validateIngestRecord } from "./validate";

const log = createLogger("order-source");

function makeRecordTraceId(context: IngestContext, index: number): string {
  return `${context.traceId}-${index}`;
}

export async function processIngestEnvelope(
  envelope: IngestEnvelopeV2,
  traceId: string
): Promise<IngestBatchResultV2> {
  const context: IngestContext = {
    traceId,
    serverTime: new Date().toISOString(),
    sourceSystem: envelope.sourceSystem
  };

  const results: IngestRecordResultV2[] = [];
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 批次内去重
  const seenKeys = new Set<string>();

  for (let i = 0; i < envelope.records.length; i++) {
    const record = envelope.records[i];
    const recordTraceId = makeRecordTraceId(context, i);

    // 1. 字段校验
    const validation = validateIngestRecord(record, i);
    if (!validation.valid) {
      const result: IngestRecordResultV2 = {
        index: i,
        externalOrderId:
          (record as unknown as Record<string, unknown>).externalOrderId as string ??
          "",
        sourceVersion:
          (record as unknown as Record<string, unknown>).sourceVersion as string ??
          "",
        status: "failed",
        reason: "VALIDATION_FAILED",
        traceId: recordTraceId
      };
      results.push(result);
      failedCount++;
      log.warn("记录校验失败", {
        traceId: recordTraceId,
        index: i,
        errors: JSON.stringify(validation.errors)
      });
      continue;
    }

    // 2. 规范化
    const normalized = normalizeRecord(record);

    // 3. 批次内去重
    const dedupKey = `${normalized.externalOrderId}:${normalized.sourceVersion}`;
    if (seenKeys.has(dedupKey)) {
      const result: IngestRecordResultV2 = {
        index: i,
        externalOrderId: normalized.externalOrderId,
        sourceVersion: normalized.sourceVersion,
        status: "skipped",
        reason: "DUPLICATE",
        traceId: recordTraceId
      };
      results.push(result);
      skippedCount++;
      log.warn("批次内重复记录，跳过", {
        traceId: recordTraceId,
        index: i,
        externalOrderId: normalized.externalOrderId,
        sourceVersion: normalized.sourceVersion
      });
      continue;
    }
    seenKeys.add(dedupKey);

    // 4. 映射为标准订单
    const canonical = mapToCanonical(
      normalized,
      context.sourceSystem,
      context.serverTime
    );

    // 5. 处理幂等性
    const recordResult = await processIngestRecord(canonical, recordTraceId);
    recordResult.index = i;

    results.push(recordResult);

    switch (recordResult.status) {
      case "success":
        successCount++;
        break;
      case "skipped":
        skippedCount++;
        break;
      case "failed":
        failedCount++;
        break;
    }
  }

  return {
    results,
    success: successCount,
    skipped: skippedCount,
    failed: failedCount
  };
}

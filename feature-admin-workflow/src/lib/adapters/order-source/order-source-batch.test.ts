import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngestBatchResultV2,
  IngestEnvelopeV2,
  IngestRecordV2
} from "@/types/v2";

// ---- Mock processIngestRecord ----
const { mockProcessIngestRecord } = vi.hoisted(() => ({
  mockProcessIngestRecord: vi.fn()
}));

vi.mock("./idempotency", () => ({
  processIngestRecord: mockProcessIngestRecord
}));

import { processIngestEnvelope } from "./index";

// ---- 测试数据工厂 ----

function makeValidRecord(overrides: Partial<IngestRecordV2> = {}): IngestRecordV2 {
  return {
    externalOrderId: "HALUO-001",
    sourceVersion: "2026-07-18T08:00:00.000Z",
    sourceStatusRaw: "待取车",
    orderNo: "ORDER-V2-001",
    businessType: "STORE_PICKUP",
    promisedPickupAt: "2026-07-18T09:00:00.000Z",
    pickupAddress: "杭州市西湖区取车点",
    pickupLat: 30.2741,
    pickupLng: 120.1551,
    deliveryAddress: "杭州市拱墅区送达点",
    deliveryLat: 30.319,
    deliveryLng: 120.142,
    storeCode: "STORE_HZ_XH",
    storeName: "杭州西湖门店",
    city: "杭州市",
    district: "西湖区",
    licensePlateSnapshot: "浙A00001",
    vehicleTypeSnapshot: "别克GL8",
    remark: "测试备注",
    ...overrides
  };
}

function makeEnvelope(
  records: IngestRecordV2[],
  sourceSystem: "HALUO" | "PLUGIN" | "API" = "HALUO"
): IngestEnvelopeV2 {
  return { sourceSystem, records };
}

function makeSuccessResult(
  index: number,
  externalOrderId: string,
  sourceVersion: string,
  traceId: string
) {
  return {
    index,
    externalOrderId,
    sourceVersion,
    status: "success" as const,
    traceId
  };
}

function makeFailedResult(
  index: number,
  externalOrderId: string,
  sourceVersion: string,
  reason: string,
  traceId: string
) {
  return {
    index,
    externalOrderId,
    sourceVersion,
    status: "failed" as const,
    reason,
    traceId
  };
}

describe("processIngestEnvelope (batch orchestration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockProcessIngestRecord.mockImplementation(async (record, traceId) =>
      makeSuccessResult(
        0,
        (record as Record<string, string>).externalOrderId,
        (record as Record<string, string>).sourceVersion,
        traceId
      )
    );
  });

  it("processes a single valid record and returns aggregated counts", async () => {
    const envelope = makeEnvelope([makeValidRecord()]);
    const result = await processIngestEnvelope(envelope, "trace-batch-1");

    expect(result.results).toHaveLength(1);
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].index).toBe(0);
  });

  it("deduplicates records within the same batch by (externalOrderId, sourceVersion)", async () => {
    const record = makeValidRecord();
    const envelope = makeEnvelope([record, record]);

    const result = await processIngestEnvelope(envelope, "trace-dedup-1");

    // First record succeeds, second is deduped
    expect(result.skipped).toBe(1);
    expect(result.results[1].status).toBe("skipped");
    expect(result.results[1].reason).toBe("DUPLICATE");
    expect(mockProcessIngestRecord).toHaveBeenCalledTimes(1);
  });

  it("marks validation failures as failed without calling processIngestRecord", async () => {
    const envelope = makeEnvelope([
      makeValidRecord(),
      {} as unknown as IngestRecordV2 // invalid - missing fields
    ]);

    const result = await processIngestEnvelope(envelope, "trace-validfail-1");

    expect(result.failed).toBeGreaterThanOrEqual(1);
    const failedResult = result.results.find((r) => r.status === "failed");
    expect(failedResult).toBeDefined();
    expect(failedResult!.reason).toBe("VALIDATION_FAILED");
    // processIngestRecord should only be called for valid records
    expect(mockProcessIngestRecord).toHaveBeenCalledTimes(1);
  });

  it("handles partial success: one record succeeds, another fails", async () => {
    mockProcessIngestRecord
      .mockImplementationOnce(async (record, traceId) =>
        makeSuccessResult(
          0,
          (record as Record<string, string>).externalOrderId,
          (record as Record<string, string>).sourceVersion,
          traceId
        )
      )
      .mockImplementationOnce(async (record, traceId) =>
        makeFailedResult(
          1,
          (record as Record<string, string>).externalOrderId,
          (record as Record<string, string>).sourceVersion,
          "STORE_NOT_FOUND",
          traceId
        )
      );

    const envelope = makeEnvelope([
      makeValidRecord({ externalOrderId: "ORDER-OK" }),
      makeValidRecord({ externalOrderId: "ORDER-FAIL" })
    ]);

    const result = await processIngestEnvelope(envelope, "trace-partial-1");

    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("success");
    expect(result.results[1].status).toBe("failed");
    expect(result.results[1].reason).toBe("STORE_NOT_FOUND");
  });

  it("correctly aggregates success/skipped/failed counts", async () => {
    // Record 1: success, Record 2: success, Record 3: batch dup of Record 2
    const envelope = makeEnvelope([
      makeValidRecord({ externalOrderId: "ORDER-1", sourceVersion: "2026-07-18T08:00:00.000Z" }),
      makeValidRecord({ externalOrderId: "ORDER-2", sourceVersion: "2026-07-18T08:00:00.000Z" }),
      makeValidRecord({ externalOrderId: "ORDER-2", sourceVersion: "2026-07-18T08:00:00.000Z" }) // dup
    ]);

    const result = await processIngestEnvelope(envelope, "trace-counts-1");

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results[2].reason).toBe("DUPLICATE");
    expect(mockProcessIngestRecord).toHaveBeenCalledTimes(2);
  });

  it("generates per-record traceIds", async () => {
    const envelope = makeEnvelope([
      makeValidRecord(),
      makeValidRecord({ externalOrderId: "ORDER-2" })
    ]);

    const result = await processIngestEnvelope(envelope, "trace-parent-1");

    expect(result.results[0].traceId).toBe("trace-parent-1-0");
    expect(result.results[1].traceId).toBe("trace-parent-1-1");
  });

  it("processes records with different sourceVersions independently", async () => {
    const envelope = makeEnvelope([
      makeValidRecord({ externalOrderId: "ORDER-1", sourceVersion: "2026-07-18T08:00:00.000Z" }),
      makeValidRecord({ externalOrderId: "ORDER-1", sourceVersion: "2026-07-18T09:00:00.000Z" })
    ]);

    const result = await processIngestEnvelope(envelope, "trace-multi-ver-1");

    // Different versions → both should be processed (not deduped)
    expect(result.skipped).toBe(0);
    expect(mockProcessIngestRecord).toHaveBeenCalledTimes(2);
  });
});

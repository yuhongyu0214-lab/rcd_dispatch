import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanonicalOrderV2,
  IngestEnvelopeV2,
  IngestRecordV2
} from "@/types/v2";

import { processIngestRecord } from "./idempotency";
import { mapToCanonical } from "./mapper";
import { normalizeRecord } from "./normalize";
import { validateIngestRecord } from "./validate";

// ---- Mock Prisma with hoisted factory ----
const { mockPrismaTransaction } = vi.hoisted(() => ({
  mockPrismaTransaction: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mockPrismaTransaction
  }
}));

// ---- 类型辅助 ----
type TransactionCallback = (tx: Record<string, unknown>) => Promise<unknown>;

function createTransactionMock() {
  return {
    order: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    orderSourceEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    operationLog: {
      create: vi.fn()
    },
    store: {
      findUnique: vi.fn()
    },
    user: {
      findFirst: vi.fn()
    }
  };
}

type TxMock = ReturnType<typeof createTransactionMock>;

function runInTransaction(tx: TxMock) {
  mockPrismaTransaction.mockImplementation(async (callback: TransactionCallback) =>
    callback(tx as unknown as Record<string, unknown>)
  );
}

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

function makeCanonical(
  overrides: Partial<CanonicalOrderV2> = {}
): CanonicalOrderV2 {
  return {
    sourceSystem: "HALUO",
    externalOrderId: "HALUO-001",
    sourceVersion: "2026-07-18T08:00:00.000Z",
    sourceStatusRaw: "待取车",
    orderNo: "ORDER-V2-001",
    businessType: "STORE_PICKUP",
    promisedPickupAt: "2026-07-18T09:00:00.000Z",
    receivedAt: "2026-07-18T08:00:30.000Z",
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

// ---- 测试套件 ----

describe("order-source adapter", () => {
  describe("validateIngestRecord", () => {
    it("passes a valid record", () => {
      const result = validateIngestRecord(makeValidRecord(), 0);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it("fails when required fields are missing", () => {
      const result = validateIngestRecord(
        {} as unknown as IngestRecordV2,
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["externalOrderId"]).toBeDefined();
      expect(result.errors["sourceVersion"]).toBeDefined();
      expect(result.errors["storeCode"]).toBeDefined();
    });

    it("fails on invalid sourceVersion format", () => {
      const result = validateIngestRecord(
        makeValidRecord({ sourceVersion: "bad-version" }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["sourceVersion"]).toBeDefined();
    });

    it("rejects v1-migration as sourceVersion in online ingest", () => {
      const result = validateIngestRecord(
        makeValidRecord({ sourceVersion: "v1-migration" }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["sourceVersion"]).toBeDefined();
      expect(result.errors["sourceVersion"][0]).toContain("v1-migration");
    });

    it("fails on invalid promisedPickupAt format", () => {
      const result = validateIngestRecord(
        makeValidRecord({ promisedPickupAt: "not-a-date" }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["promisedPickupAt"]).toBeDefined();
    });

    it("fails on invalid cancelledAt format", () => {
      const result = validateIngestRecord(
        makeValidRecord({ cancelledAt: "not-a-date" }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["cancelledAt"]).toBeDefined();
    });

    it("fails on partial coordinates", () => {
      const result = validateIngestRecord(
        makeValidRecord({ pickupLat: 30.2741, pickupLng: undefined }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["pickupLat/pickupLng"]).toBeDefined();
    });

    it("fails on invalid businessType", () => {
      const result = validateIngestRecord(
        makeValidRecord({ businessType: "INVALID_TYPE" as IngestRecordV2["businessType"] }),
        0
      );
      expect(result.valid).toBe(false);
      expect(result.errors["businessType"]).toBeDefined();
    });

    it("accepts sequence-based sourceVersion", () => {
      const result = validateIngestRecord(
        makeValidRecord({ sourceVersion: "12345" }),
        0
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("normalizeRecord", () => {
    it("trims whitespace from all string fields", () => {
      const record = makeValidRecord({
        externalOrderId: "  HALUO-001  ",
        pickupAddress: "  杭州市西湖区  "
      });
      const normalized = normalizeRecord(record);
      expect(normalized.externalOrderId).toBe("HALUO-001");
      expect(normalized.pickupAddress).toBe("杭州市西湖区");
    });

    it("rounds coordinates to 6 decimal places", () => {
      const record = makeValidRecord({
        pickupLat: 30.2741234567,
        pickupLng: 120.1551987654
      });
      const normalized = normalizeRecord(record);
      expect(normalized.pickupLat).toBe(30.274123);
      expect(normalized.pickupLng).toBe(120.155199);
    });

    it("converts null coordinates to undefined", () => {
      const record = makeValidRecord({
        pickupLat: undefined,
        pickupLng: undefined
      });
      const raw = { ...record, pickupLat: null as unknown as undefined, pickupLng: null as unknown as undefined };
      const normalized = normalizeRecord(raw as unknown as IngestRecordV2);
      expect(normalized.pickupLat).toBeUndefined();
      expect(normalized.pickupLng).toBeUndefined();
    });
  });

  describe("mapToCanonical", () => {
    it("maps normalized record to canonical with server-side fields", () => {
      const record = makeValidRecord();
      const normalized = normalizeRecord(record);
      const receivedAt = "2026-07-18T08:00:30.000Z";
      const canonical = mapToCanonical(normalized, "HALUO", receivedAt);

      expect(canonical.sourceSystem).toBe("HALUO");
      expect(canonical.receivedAt).toBe(receivedAt);
      expect(canonical.externalOrderId).toBe("HALUO-001");
      expect(canonical.orderNo).toBe("ORDER-V2-001");
    });
  });

  describe("processIngestRecord (idempotency)", () => {
    let tx: TxMock;

    beforeEach(() => {
      vi.clearAllMocks();
      tx = createTransactionMock();
      runInTransaction(tx);

      // 默认门店存在
      tx.store.findUnique.mockResolvedValue({
        id: "store-hz"
      });

      // 默认操作人存在
      tx.user.findFirst.mockResolvedValue({
        id: "user-system"
      });
    });

    // --- Same version replay ---
    it("returns replayed=true when same version event already exists", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue({
        id: "event-1",
        orderId: "order-1",
        result: "SUCCESS",
        reason: null
      });

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-replay-1"
      );

      expect(result.status).toBe("success");
      expect(result.replayed).toBe(true);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it("returns skipped for same version SKIPPED event", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue({
        id: "event-1",
        orderId: "order-1",
        result: "SKIPPED",
        reason: "STALE_VERSION"
      });

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-replay-skip"
      );

      expect(result.status).toBe("skipped");
      expect(result.replayed).toBe(true);
    });

    // --- New version update ---
    it("creates new order when no existing order found", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(null);
      tx.order.create.mockResolvedValue({
        id: "order-new",
        orderNo: "ORDER-V2-001",
        executionStatus: "UNASSIGNED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-new-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.create).toHaveBeenCalled();
      expect(tx.orderSourceEvent.upsert).toHaveBeenCalled();
    });

    it("updates existing order on newer version", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "UNASSIGNED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-update-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.update).toHaveBeenCalled();
      expect(tx.orderSourceEvent.upsert).toHaveBeenCalled();
    });

    // --- Old version (stale) ---
    it("skips stale version with STALE_VERSION reason", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T09:00:00.000Z",
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-stale-1"
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("STALE_VERSION");
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(tx.orderSourceEvent.upsert).toHaveBeenCalled();
    });

    // --- v1-migration baseline → new version updates ---
    it("allows update over v1-migration baseline", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "v1-migration",
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "UNASSIGNED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-v1mig-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.update).toHaveBeenCalled();
    });

    // --- Cancel scenarios ---
    it("cancels UNASSIGNED order normally", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "CANCELLED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          sourceVersion: "2026-07-18T08:00:00.000Z",
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-cancel-1"
      );

      expect(result.status).toBe("success");
      expect(result.reason).toBeUndefined();
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executionStatus: "CANCELLED",
            status: "CANCELLED"
          })
        })
      );
    });

    it("returns FOLLOW_UP_REQUIRED when cancelling IN_SERVICE order", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "IN_SERVICE",
        status: "IN_PROGRESS",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "IN_SERVICE"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          sourceVersion: "2026-07-18T08:00:00.000Z",
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-cancel-in-service-1"
      );

      expect(result.status).toBe("success");
      expect(result.reason).toBe("FOLLOW_UP_REQUIRED");
      // snapshot should be updated but executionStatus unchanged
    });

    it("handles COMPLETED cancellation with FOLLOW_UP_REQUIRED", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "COMPLETED",
        status: "COMPLETED",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "COMPLETED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          sourceVersion: "2026-07-18T08:00:00.000Z",
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-cancel-completed-1"
      );

      expect(result.status).toBe("success");
      expect(result.reason).toBe("FOLLOW_UP_REQUIRED");
    });

    it("replays already CANCELLED order cancel", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-existing",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "CANCELLED",
        status: "CANCELLED",
        currentAssignmentId: null
      });
      tx.order.update.mockResolvedValue({
        id: "order-existing",
        executionStatus: "CANCELLED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          sourceVersion: "2026-07-18T08:00:00.000Z",
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-cancel-replay-1"
      );

      expect(result.status).toBe("success");
    });

    // --- New order created as CANCELLED ---
    it("creates new order as CANCELLED when cancelledAt is present", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(null);
      tx.order.create.mockResolvedValue({
        id: "order-new-cancel",
        orderNo: "ORDER-V2-001",
        executionStatus: "CANCELLED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-new-cancel-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executionStatus: "CANCELLED"
          })
        })
      );
    });

    // --- DB unique constraint race ---
    it("handles P2002 unique constraint gracefully", async () => {
      // 模拟第一个事务因为 P2002 失败（并发写入），事务层捕获并返回 skipped
      const p2002Error = Object.assign(
        new Error("Unique constraint failed"),
        { code: "P2002" }
      );

      // 直接 mock $transaction 抛出 P2002
      mockPrismaTransaction.mockRejectedValueOnce(p2002Error);

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-race-1"
      );

      // P2002 handled as skipped in the catch block
      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("DUPLICATE");
      expect(result.replayed).toBe(true);
    });

    // --- Store not found ---
    it("returns failed when store not found for new order", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(null);
      tx.store.findUnique.mockResolvedValue(null);
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-no-store-1"
      );

      expect(result.status).toBe("failed");
      expect(result.reason).toBe("STORE_NOT_FOUND");
    });

    // --- sourceStatusRaw only on event, never on order ---
    it("does NOT write sourceStatusRaw to Order snapshot", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(null);
      tx.order.create.mockResolvedValue({
        id: "order-new",
        orderNo: "ORDER-V2-001",
        executionStatus: "UNASSIGNED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      await processIngestRecord(makeCanonical(), "trace-srcstatus-1");

      const createCall = tx.order.create.mock.calls[0][0];
      expect(createCall.data).not.toHaveProperty("sourceStatusRaw");
    });
  });

});

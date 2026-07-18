import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanonicalOrderV2,
  IngestRecordV2
} from "@/types/v2";

import { processIngestRecord } from "./idempotency";
import { mapToCanonical } from "./mapper";
import { normalizeRecord } from "./normalize";
import { isSourceStatusCancelled, validateIngestRecord } from "./validate";

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
      update: vi.fn(),
      updateMany: vi.fn()
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
    },
    assignment: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    driver: {
      update: vi.fn()
    },
    dispatchAlert: {
      updateMany: vi.fn()
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

  // P1-4: sourceStatusRaw 取消状态识别（按来源系统精确映射）
  describe("isSourceStatusCancelled (P1-4)", () => {
    it("recognizes HALUO Chinese cancel statuses", () => {
      expect(isSourceStatusCancelled("已取消", "HALUO")).toBe(true);
      expect(isSourceStatusCancelled("取消", "HALUO")).toBe(true);
      expect(isSourceStatusCancelled("已撤销", "HALUO")).toBe(true);
    });

    it("recognizes API English cancel statuses case-insensitively", () => {
      expect(isSourceStatusCancelled("CANCELLED", "API")).toBe(true);
      expect(isSourceStatusCancelled("cancelled", "API")).toBe(true);
      expect(isSourceStatusCancelled("Cancel", "API")).toBe(true);
      expect(isSourceStatusCancelled("  CANCELED  ", "API")).toBe(true);
      expect(isSourceStatusCancelled("VOID", "API")).toBe(true);
    });

    it("recognizes PLUGIN mixed-language cancel statuses", () => {
      expect(isSourceStatusCancelled("已取消", "PLUGIN")).toBe(true);
      expect(isSourceStatusCancelled("cancelled", "PLUGIN")).toBe(true);
    });

    // P1 返修: CLOSED/关闭 在部分来源表示正常完结，不得判为取消
    it("does NOT treat ambiguous CLOSED/关闭 as cancelled in any source (P1)", () => {
      expect(isSourceStatusCancelled("已关闭", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("关闭", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("CLOSED", "API")).toBe(false);
      expect(isSourceStatusCancelled("closed", "PLUGIN")).toBe(false);
    });

    // P1 返修: 词表按来源隔离，不跨来源生效
    it("scopes cancel vocabulary per source system (P1)", () => {
      expect(isSourceStatusCancelled("CANCELLED", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("已取消", "API")).toBe(false);
    });

    it("does not match non-cancel or negated statuses", () => {
      expect(isSourceStatusCancelled("待取车", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("未取消", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("进行中", "HALUO")).toBe(false);
      expect(isSourceStatusCancelled("", "HALUO")).toBe(false);
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

    // P1-4: sourceStatusRaw 表示取消 → cancelledAt 兜底为 receivedAt
    it("maps cancelled sourceStatusRaw to cancelledAt=receivedAt when cancelledAt missing (P1-4)", () => {
      const record = makeValidRecord({
        sourceStatusRaw: "已取消",
        cancelledAt: undefined
      });
      const normalized = normalizeRecord(record);
      const receivedAt = "2026-07-18T08:00:30.000Z";
      const canonical = mapToCanonical(normalized, "HALUO", receivedAt);

      expect(canonical.cancelledAt).toBe(receivedAt);
    });

    it("keeps explicit cancelledAt over sourceStatusRaw-derived value (P1-4)", () => {
      const record = makeValidRecord({
        sourceStatusRaw: "已取消",
        cancelledAt: "2026-07-18T07:59:00.000Z"
      });
      const normalized = normalizeRecord(record);
      const canonical = mapToCanonical(
        normalized,
        "HALUO",
        "2026-07-18T08:00:30.000Z"
      );

      expect(canonical.cancelledAt).toBe("2026-07-18T07:59:00.000Z");
    });

    it("leaves cancelledAt undefined for non-cancel sourceStatusRaw (P1-4)", () => {
      const record = makeValidRecord({ sourceStatusRaw: "待取车" });
      const normalized = normalizeRecord(record);
      const canonical = mapToCanonical(
        normalized,
        "HALUO",
        "2026-07-18T08:00:30.000Z"
      );

      expect(canonical.cancelledAt).toBeUndefined();
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

      // 默认乐观锁更新命中 1 行
      tx.order.updateMany.mockResolvedValue({ count: 1 });
    });

    // --- Same version replay (P1-1) ---
    it("returns skipped + replayed for same version SUCCESS event (P1-1)", async () => {
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

      expect(result.status).toBe("skipped");
      expect(result.replayed).toBe(true);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
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

    it("returns skipped + replayed for same version MIGRATED event (P1-1)", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue({
        id: "event-1",
        orderId: "order-1",
        result: "MIGRATED",
        reason: null
      });

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-replay-migrated"
      );

      expect(result.status).toBe("skipped");
      expect(result.replayed).toBe(true);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it("retries processing when same version event is FAILED", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue({
        id: "event-1",
        orderId: null,
        result: "FAILED",
        reason: "STORE_NOT_FOUND"
      });
      tx.order.findUnique.mockResolvedValue(null);
      tx.order.create.mockResolvedValue({
        id: "order-new",
        orderNo: "ORDER-V2-001",
        executionStatus: "UNASSIGNED"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-failed-retry"
      );

      expect(result.status).toBe("success");
      expect(result.replayed).toBeUndefined();
      expect(tx.order.create).toHaveBeenCalled();
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
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-update-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.updateMany).toHaveBeenCalled();
      expect(tx.orderSourceEvent.upsert).toHaveBeenCalled();
    });

    // --- P0-1: 元数据更新不得破坏执行状态 ---
    it("keeps PLANNED executionStatus when a newer version updates metadata (P0-1)", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-planned",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "PLANNED",
        status: "ASSIGNED",
        currentAssignmentId: "assignment-1"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-p01-planned"
      );

      expect(result.status).toBe("success");
      expect(tx.order.updateMany).toHaveBeenCalledTimes(1);

      const call = tx.order.updateMany.mock.calls[0][0];
      // 更新数据只含元数据，绝不覆盖执行状态与派单指针
      expect(call.data).not.toHaveProperty("executionStatus");
      expect(call.data).not.toHaveProperty("status");
      expect(call.data).not.toHaveProperty("currentAssignmentId");
      // 元数据字段确实被更新
      expect(call.data).toHaveProperty("pickupAddress");
      expect(call.data).toHaveProperty("sourceVersion", "2026-07-18T08:00:00.000Z");
    });

    // --- P0-3: 版本竞争（乐观锁） ---
    it("retries on concurrent version race and settles on re-read (P0-3)", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      // 第一次读到 v(07:00)，写入时已被并发事务改为 v(09:00) → 命中 0 行；
      // 重试后读到 v(09:00)，本次 v(08:00) 判定为 STALE_VERSION
      tx.order.findUnique
        .mockResolvedValueOnce({
          id: "order-race",
          sourceVersion: "2026-07-18T07:00:00.000Z",
          executionStatus: "UNASSIGNED",
          status: "PENDING",
          currentAssignmentId: null
        })
        .mockResolvedValueOnce({
          id: "order-race",
          sourceVersion: "2026-07-18T09:00:00.000Z",
          executionStatus: "UNASSIGNED",
          status: "PENDING",
          currentAssignmentId: null
        });
      tx.order.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-p03-race"
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("STALE_VERSION");
      expect(mockPrismaTransaction).toHaveBeenCalledTimes(2);
      // 乐观锁 WHERE 必须带读取时的 sourceVersion
      const firstUpdate = tx.order.updateMany.mock.calls[0][0];
      expect(firstUpdate.where).toMatchObject({
        id: "order-race",
        sourceVersion: "2026-07-18T07:00:00.000Z"
      });
    });

    it("fails after exhausting version race retries (P0-3)", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-race",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "UNASSIGNED",
        status: "PENDING",
        currentAssignmentId: null
      });
      tx.order.updateMany.mockResolvedValue({ count: 0 });

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-p03-exhausted"
      );

      expect(result.status).toBe("failed");
      expect(mockPrismaTransaction).toHaveBeenCalledTimes(3);
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
      expect(tx.order.updateMany).not.toHaveBeenCalled();
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
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T08:00:00.000Z" }),
        "trace-v1mig-1"
      );

      expect(result.status).toBe("success");
      expect(tx.order.updateMany).toHaveBeenCalled();
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
      expect(tx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executionStatus: "CANCELLED",
            status: "CANCELLED"
          })
        })
      );
      // 没有当前派单 → 不应释放任何 Assignment
      expect(tx.assignment.update).not.toHaveBeenCalled();
      expect(tx.driver.update).not.toHaveBeenCalled();
    });

    // --- P0 返修: 取消不越权 Gate 3 —— 1A 只落地取消事实与待释放意图 ---
    it("cancels PLANNED order with fact + pending-release intent, never touching dispatch entities (P0)", async () => {
      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue({
        id: "order-planned",
        sourceVersion: "2026-07-18T07:00:00.000Z",
        executionStatus: "PLANNED",
        status: "ASSIGNED",
        currentAssignmentId: "assignment-1"
      });
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({
          sourceVersion: "2026-07-18T08:00:00.000Z",
          cancelledAt: "2026-07-18T08:30:00.000Z"
        }),
        "trace-p02-cancel"
      );

      expect(result.status).toBe("success");

      // 1) 订单取消事实原子落地；currentAssignmentId 保持原值作为待释放意图，不得清空
      expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
      const call = tx.order.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        id: "order-planned",
        sourceVersion: "2026-07-18T07:00:00.000Z"
      });
      expect(call.data).toMatchObject({
        executionStatus: "CANCELLED",
        status: "CANCELLED"
      });
      expect(call.data).not.toHaveProperty("currentAssignmentId");

      // 2) 所有权边界：Assignment / Driver.planVersion / DispatchAlert 属 Gate 3
      //    单一事务集成线，1A 一律不写
      expect(tx.assignment.findUnique).not.toHaveBeenCalled();
      expect(tx.assignment.update).not.toHaveBeenCalled();
      expect(tx.driver.update).not.toHaveBeenCalled();
      expect(tx.dispatchAlert.updateMany).not.toHaveBeenCalled();

      // 3) 只写 ORDER/CANCEL 日志，元数据记录待释放意图供 Gate 3 追溯
      const logDatas = tx.operationLog.create.mock.calls.map(
        (c) =>
          (c[0] as { data: { action: string; metadataJson: Record<string, unknown> } })
            .data
      );
      expect(logDatas.map((d) => d.action)).toEqual(["CANCEL"]);
      expect(logDatas[0].metadataJson).toMatchObject({
        pendingReleaseAssignmentId: "assignment-1"
      });
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
      // snapshot 更新但执行状态保持不变
      const call = tx.order.updateMany.mock.calls[0][0];
      expect(call.data).not.toHaveProperty("executionStatus");
      expect(call.data).not.toHaveProperty("status");
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

    // --- P0 返修: P2002 必须重入事务重读分流，不得直接判 DUPLICATE ---
    it("re-enters transaction on first-create P2002 and applies the newer version (P0)", async () => {
      // 审阅场景：v2 / v3 同时查到订单不存在，v2 先建单；
      // v3 create 撞 Order 唯一键 → 不能丢弃，重读后按版本规则落为 update
      const p2002Error = Object.assign(
        new Error("Unique constraint failed"),
        { code: "P2002" }
      );

      tx.orderSourceEvent.findUnique.mockResolvedValue(null);
      tx.order.findUnique
        .mockResolvedValueOnce(null) // 第一次事务：订单不存在 → 走 create
        .mockResolvedValueOnce({
          // 重试事务：重读拿到 v2 建的订单
          id: "order-create-race",
          sourceVersion: "2026-07-18T08:00:00.000Z",
          executionStatus: "UNASSIGNED",
          status: "PENDING",
          currentAssignmentId: null
        });
      tx.order.create.mockRejectedValueOnce(p2002Error);
      tx.orderSourceEvent.upsert.mockResolvedValue({});

      const result = await processIngestRecord(
        makeCanonical({ sourceVersion: "2026-07-18T09:00:00.000Z" }),
        "trace-p2002-create-race"
      );

      // v3 快照必须成功落库，而不是被当作重复丢弃
      expect(result.status).toBe("success");
      expect(result.reason).toBeUndefined();
      expect(mockPrismaTransaction).toHaveBeenCalledTimes(2);

      expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
      const updateCall = tx.order.updateMany.mock.calls[0][0];
      expect(updateCall.where).toMatchObject({
        id: "order-create-race",
        sourceVersion: "2026-07-18T08:00:00.000Z"
      });
      expect(updateCall.data).toHaveProperty(
        "sourceVersion",
        "2026-07-18T09:00:00.000Z"
      );
    });

    it("re-enters transaction on P2002 and settles as replay for same version (P0)", async () => {
      const p2002Error = Object.assign(
        new Error("Unique constraint failed"),
        { code: "P2002" }
      );

      // 第一次事务因并发写入同幂等键失败；重试后读到同版本事件 → replay
      mockPrismaTransaction.mockRejectedValueOnce(p2002Error);
      tx.orderSourceEvent.findUnique.mockResolvedValue({
        id: "event-dup",
        orderId: "order-1",
        result: "SUCCESS",
        reason: null
      });

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-p2002-replay"
      );

      expect(result.status).toBe("skipped");
      expect(result.replayed).toBe(true);
      expect(mockPrismaTransaction).toHaveBeenCalledTimes(2);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it("fails after exhausting P2002 retries instead of mislabeling DUPLICATE (P0)", async () => {
      const p2002Error = Object.assign(
        new Error("Unique constraint failed"),
        { code: "P2002" }
      );

      mockPrismaTransaction
        .mockRejectedValueOnce(p2002Error)
        .mockRejectedValueOnce(p2002Error)
        .mockRejectedValueOnce(p2002Error);

      const result = await processIngestRecord(
        makeCanonical(),
        "trace-p2002-exhausted"
      );

      expect(result.status).toBe("failed");
      expect(result.reason).toBeUndefined();
      expect(mockPrismaTransaction).toHaveBeenCalledTimes(3);
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

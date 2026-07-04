import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { confirmRecommendedDispatch } from "./confirm";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    assignment: {
      create: vi.fn()
    },
    driver: {
      findUnique: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

type TransactionMock = ReturnType<typeof createTransactionMock>;
type TransactionCallback = (tx: TransactionMock) => Promise<unknown>;

function createTransactionMock() {
  return {
    assignment: {
      create: vi.fn()
    },
    driver: {
      update: vi.fn()
    },
    operationLog: {
      create: vi.fn()
    },
    order: {
      update: vi.fn(),
      updateMany: vi.fn()
    }
  };
}

function mockDispatchableOrderAndDriver() {
  vi.mocked(prisma.order.findUnique).mockResolvedValue({
    id: "order-1",
    orderNo: "D3832",
    status: "RECOMMENDING"
  } as unknown as Awaited<ReturnType<typeof prisma.order.findUnique>>);
  vi.mocked(prisma.driver.findUnique).mockResolvedValue({
    id: "driver-1",
    isActive: true,
    name: "李强",
    status: "S1"
  } as unknown as Awaited<ReturnType<typeof prisma.driver.findUnique>>);
}

function runInTransaction(tx: TransactionMock) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
    (callback as unknown as TransactionCallback)(tx)
  );
}

describe("confirmRecommendedDispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchableOrderAndDriver();
  });

  it("confirms a recommended assignment after atomically claiming the order", async () => {
    const tx = createTransactionMock();
    runInTransaction(tx);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.assignment.create.mockResolvedValue({ id: "assignment-1" });
    tx.order.update.mockResolvedValue({
      id: "order-1",
      status: "ASSIGNED"
    });

    const result = await confirmRecommendedDispatch({
      driverId: "driver-1",
      operatorUserId: "user-admin",
      orderId: "order-1",
      traceId: "trace-1"
    });

    expect(result.success).toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      data: {
        driverNameSnapshot: "李强",
        status: "ASSIGNED"
      },
      where: {
        currentAssignmentId: null,
        id: "order-1",
        status: { in: ["PENDING", "RECOMMENDING"] }
      }
    });
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: {
        createdByUserId: "user-admin",
        driverId: "driver-1",
        orderId: "order-1",
        status: "ACTIVE",
        type: "RECOMMEND_ASSIGN"
      }
    });
  });

  it("returns conflict and does not create assignment when another request claimed the order", async () => {
    const tx = createTransactionMock();
    runInTransaction(tx);
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await confirmRecommendedDispatch({
      driverId: "driver-1",
      operatorUserId: "user-admin",
      orderId: "order-1",
      traceId: "trace-1"
    });

    expect(result).toEqual({
      error: "订单状态已变化，请刷新后重试",
      status: 409,
      success: false
    });
    expect(tx.assignment.create).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });
});

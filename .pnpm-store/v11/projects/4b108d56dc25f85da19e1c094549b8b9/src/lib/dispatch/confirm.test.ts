import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { confirmRecommendedDispatch } from "./confirm";

// Mock Prisma
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

// Mock Redis — lock always acquired, release always succeeds
vi.mock("@/lib/redis", () => ({
  acquireDispatchLock: vi.fn().mockResolvedValue(true),
  releaseDispatchLock: vi.fn().mockResolvedValue(undefined)
}));

import { acquireDispatchLock, releaseDispatchLock } from "@/lib/redis";

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
    currentAssignment: null,
    currentAssignmentId: null,
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
    // Reset Redis mocks to default (lock acquired)
    vi.mocked(acquireDispatchLock).mockResolvedValue(true);
    vi.mocked(releaseDispatchLock).mockResolvedValue(undefined);
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
    // Redis lock was acquired
    expect(acquireDispatchLock).toHaveBeenCalledWith("order-1", 10);
    // Prisma optimistic lock was used
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
    // Redis lock was released
    expect(releaseDispatchLock).toHaveBeenCalledWith("order-1");
  });

  it("confirms when a recycled assignment pointer is still attached to the order", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      currentAssignment: {
        id: "assignment-recycled",
        status: "RECYCLED"
      },
      currentAssignmentId: "assignment-recycled",
      id: "order-1",
      orderNo: "D3832",
      status: "RECOMMENDING"
    } as unknown as Awaited<ReturnType<typeof prisma.order.findUnique>>);

    const tx = createTransactionMock();
    runInTransaction(tx);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.assignment.create.mockResolvedValue({ id: "assignment-2" });
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
        currentAssignmentId: "assignment-recycled",
        id: "order-1",
        status: { in: ["PENDING", "RECOMMENDING"] }
      }
    });
    expect(releaseDispatchLock).toHaveBeenCalledWith("order-1");
  });

  it("returns conflict when the order already has an active assignment", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      currentAssignment: {
        id: "assignment-active",
        status: "ACTIVE"
      },
      currentAssignmentId: "assignment-active",
      id: "order-1",
      orderNo: "D3832",
      status: "RECOMMENDING"
    } as unknown as Awaited<ReturnType<typeof prisma.order.findUnique>>);

    const result = await confirmRecommendedDispatch({
      driverId: "driver-1",
      operatorUserId: "user-admin",
      orderId: "order-1",
      traceId: "trace-1"
    });

    expect(result).toEqual({
      error: "订单已有有效派单，请使用改派",
      status: 409,
      success: false
    });
    expect(prisma.driver.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Lock was never acquired in this early-return path, so release should NOT be called
    expect(releaseDispatchLock).not.toHaveBeenCalled();
    expect(acquireDispatchLock).not.toHaveBeenCalled();
  });

  it("returns conflict when Redis lock cannot be acquired", async () => {
    vi.mocked(acquireDispatchLock).mockResolvedValue(false);

    const result = await confirmRecommendedDispatch({
      driverId: "driver-1",
      operatorUserId: "user-admin",
      orderId: "order-1",
      traceId: "trace-1"
    });

    expect(result).toEqual({
      error: "订单正在被其他调度员操作，请稍后重试",
      status: 409,
      success: false
    });
    // Transaction should not be called when lock is not acquired
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // releaseDispatchLock should NOT be called when lock was never acquired
    expect(releaseDispatchLock).not.toHaveBeenCalled();
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
    // Lock should still be released after transaction failure
    expect(releaseDispatchLock).toHaveBeenCalledWith("order-1");
  });
});

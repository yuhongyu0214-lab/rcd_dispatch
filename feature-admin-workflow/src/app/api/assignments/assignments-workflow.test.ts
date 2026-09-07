import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

import { POST as assignOrder } from "./route";
import { POST as reassignOrder } from "./reassign/route";
import { POST as withdrawOrder } from "./withdraw/route";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn()
  }
}));

type TransactionMock = ReturnType<typeof createTransactionMock>;
type TransactionCallback = (tx: TransactionMock) => Promise<unknown>;
type TransactionRunner = (
  callback: TransactionCallback,
  options?: unknown
) => Promise<unknown>;

function createTransactionMock() {
  return {
    assignment: {
      create: vi.fn(),
      update: vi.fn()
    },
    driver: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    operationLog: {
      create: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  };
}

function mockAdminUser() {
  vi.mocked(getCurrentUser).mockResolvedValue({
    email: "admin@dispatch.dev",
    id: "user-admin",
    name: "运营管理员",
    role: "admin",
    driverId: null
  });
}

function runInTransaction(tx: TransactionMock) {
  const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

  transaction.mockImplementation(async (callback: TransactionCallback) =>
    callback(tx)
  );
}

function createRequest(path: string, body: object) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
}

describe("assignments workflow routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminUser();
  });

  it("assigns a PENDING order and writes assignment plus operation log", async () => {
    const tx = createTransactionMock();
    runInTransaction(tx);

    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNo: "D3832",
      status: "PENDING"
    });
    tx.driver.findUnique.mockResolvedValue({
      id: "driver-1",
      isActive: true,
      name: "李强",
      status: "S1"
    });
    tx.assignment.create.mockResolvedValue({ id: "assignment-1" });
    tx.order.update.mockResolvedValue({
      currentAssignmentId: "assignment-1",
      id: "order-1",
      status: "ASSIGNED"
    });
    tx.driver.update.mockResolvedValue({ id: "driver-1", status: "S3" });
    tx.operationLog.create.mockResolvedValue({ id: "log-1" });

    const response = await assignOrder(
      createRequest("/api/assignments", {
        driverId: "driver-1",
        orderId: "order-1"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: "driver-1",
        orderId: "order-1",
        status: "ACTIVE",
        type: "MANUAL_ASSIGN"
      })
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currentAssignmentId: "assignment-1",
        driverNameSnapshot: "李强",
        status: "ASSIGNED"
      }),
      where: { id: "order-1" }
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ASSIGN",
        entityId: "order-1",
        metadataJson: expect.objectContaining({
          driverId: "driver-1",
          driverName: "李强",
          fromStatus: "PENDING",
          orderNo: "D3832",
          toStatus: "ASSIGNED"
        })
      })
    });
  });

  it("reassigns an ASSIGNED order and records old driver, new driver, and reason", async () => {
    const tx = createTransactionMock();
    runInTransaction(tx);

    tx.order.findUnique.mockResolvedValue({
      currentAssignment: {
        driver: { id: "driver-old", name: "李强" },
        driverId: "driver-old",
        id: "assignment-old",
        status: "ACTIVE",
      },
      id: "order-1",
      orderNo: "D3832",
      status: "ASSIGNED"
    });
    tx.driver.findUnique.mockResolvedValue({
      id: "driver-new",
      isActive: true,
      name: "周敏",
      status: "S2"
    });
    tx.assignment.update.mockResolvedValue({
      id: "assignment-old",
      status: "RECYCLED"
    });
    tx.assignment.create.mockResolvedValue({ id: "assignment-new" });
    tx.order.update.mockResolvedValue({
      currentAssignmentId: "assignment-new",
      id: "order-1",
      status: "ASSIGNED"
    });
    tx.driver.update.mockResolvedValue({ id: "driver-new", status: "S3" });
    tx.operationLog.create.mockResolvedValue({ id: "log-2" });

    const response = await reassignOrder(
      createRequest("/api/assignments/reassign", {
        driverId: "driver-new",
        orderId: "order-1",
        reason: "司机临时不可用"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(tx.assignment.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "RECYCLED" }),
      where: { id: "assignment-old" }
    });
    expect(tx.assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: "driver-new",
        orderId: "order-1",
        previousAssignmentId: "assignment-old",
        status: "ACTIVE",
        type: "REASSIGN"
      })
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "REASSIGN",
        entityId: "order-1",
        reason: "司机临时不可用",
        metadataJson: expect.objectContaining({
          fromDriverId: "driver-old",
          fromDriverName: "李强",
          nextAssignmentId: "assignment-new",
          previousAssignmentId: "assignment-old",
          toDriverId: "driver-new",
          toDriverName: "周敏"
        })
      })
    });
  });

  it("withdraws an ASSIGNED order back to PENDING and logs the recycle flow", async () => {
    const tx = createTransactionMock();
    runInTransaction(tx);

    tx.order.findUnique.mockResolvedValue({
      currentAssignment: {
        driver: { id: "driver-1", name: "李强" },
        driverId: "driver-1",
        id: "assignment-1",
        status: "ACTIVE",
      },
      id: "order-1",
      orderNo: "D3832",
      status: "ASSIGNED"
    });
    tx.assignment.update.mockResolvedValue({
      id: "assignment-1",
      status: "RECYCLED"
    });
    tx.driver.update.mockResolvedValue({ id: "driver-1", status: "S1" });
    tx.order.update.mockResolvedValue({
      currentAssignmentId: null,
      driverNameSnapshot: null,
      id: "order-1",
      status: "PENDING"
    });
    tx.operationLog.create.mockResolvedValue({ id: "log-3" });

    const response = await withdrawOrder(
      createRequest("/api/assignments/withdraw", {
        orderId: "order-1",
        reason: "门店调整"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(tx.assignment.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "RECYCLED" }),
      where: { id: "assignment-1" }
    });
    expect(tx.driver.update).toHaveBeenCalledWith({
      data: { status: "S1" },
      where: { id: "driver-1" }
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      data: {
        currentAssignmentId: null,
        driverNameSnapshot: null,
        status: "PENDING"
      },
      where: { id: "order-1" }
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "WITHDRAW",
        entityId: "order-1",
        reason: "门店调整",
        metadataJson: expect.objectContaining({
          assignmentId: "assignment-1",
          driverId: "driver-1",
          driverName: "李强",
          stateFlow: ["ASSIGNED", "RECYCLED", "PENDING"]
        })
      })
    });
  });
});

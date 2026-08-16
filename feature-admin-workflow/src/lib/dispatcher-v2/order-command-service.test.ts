import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: vi.fn() },
    $transaction: vi.fn()
  }
}));
vi.mock("@/lib/redis", () => ({
  acquireResourceLocks: vi.fn(),
  releaseResourceLock: vi.fn()
}));
vi.mock("@/lib/events/store", () => ({ enqueueInternalEvent: vi.fn() }));
vi.mock("@/lib/events/processor", () => ({ processInternalEvent: vi.fn() }));
vi.mock("@/lib/import/services/geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { processInternalEvent } from "@/lib/events/processor";
import { enqueueInternalEvent } from "@/lib/events/store";
import { geocodeAddress } from "@/lib/import/services/geocode";
import { prisma } from "@/lib/prisma";
import { acquireResourceLocks, releaseResourceLock } from "@/lib/redis";

import { cancelOrder, updateOrder } from "./order-command-service";

function transactionMock() {
  return {
    $queryRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    driver: { findUnique: vi.fn(), update: vi.fn() },
    assignment: { update: vi.fn() },
    dispatchAlert: { updateMany: vi.fn() },
    operationLog: { create: vi.fn() }
  };
}

function runTransaction(tx: ReturnType<typeof transactionMock>) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
    callback(tx as never)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(acquireResourceLocks).mockImplementation(async (resources) =>
    new Map(resources.map(({ resourceKey }) => [resourceKey, "acquired"]))
  );
  vi.mocked(releaseResourceLock).mockResolvedValue();
  vi.mocked(enqueueInternalEvent).mockResolvedValue({
    eventId: "event-1",
    committed: true
  });
  vi.mocked(processInternalEvent).mockResolvedValue("processed");
  vi.mocked(geocodeAddress).mockResolvedValue({
    success: true,
    lat: 31.2304,
    lng: 121.4737,
    geocodeStatus: "SUCCESS"
  });
});

describe("updateOrder", () => {
  it("geocodes a changed address before atomically committing coordinates, log and outbox", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      pickupAddress: "旧取车点",
      deliveryAddress: "旧送达点",
      currentAssignment: { id: "assignment-1", driverId: "driver-1" }
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "PLANNED",
      promisedPickupAt: new Date("2026-08-16T08:00:00.000Z"),
      pickupAddress: "旧取车点",
      pickupLat: 30,
      pickupLng: 120,
      deliveryAddress: "旧送达点",
      deliveryLat: 31,
      deliveryLng: 121,
      currentAssignment: {
        id: "assignment-1",
        driverId: "driver-1",
        status: "ACTIVE"
      }
    });
    tx.driver.findUnique.mockResolvedValue({ planVersion: 4 });

    const command = {
      orderId: "order-1",
      pickupAddress: "新取车点",
      reason: "客户改址",
      operatorUserId: "dispatcher-1",
      traceId: "trace-update"
    };
    const result = await updateOrder(command);

    expect(result).toEqual({
      success: true,
      data: { orderId: "order-1", planVersion: 5, replayed: false }
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: expect.objectContaining({
        pickupAddress: "新取车点",
        pickupLat: 31.2304,
        pickupLng: 121.4737,
        feasibility: "UNKNOWN",
        slackMinutes: null
      })
    });
    expect(geocodeAddress).toHaveBeenCalledTimes(1);
    expect(geocodeAddress).toHaveBeenCalledWith("新取车点", "取车地址");
    expect(
      vi.mocked(geocodeAddress).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]);
    expect(tx.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { planVersion: 5 }
    });
    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "ORDER_UPDATED",
        orderId: "order-1",
        driverId: "driver-1",
        traceId: "trace-update"
      })
    );
    expect(processInternalEvent).toHaveBeenCalledTimes(1);

    const firstEventId =
      vi.mocked(enqueueInternalEvent).mock.calls[0]?.[1].eventId;
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "PLANNED",
      promisedPickupAt: new Date("2026-08-16T08:00:00.000Z"),
      pickupAddress: "其他取车点",
      deliveryAddress: "旧送达点",
      currentAssignment: {
        id: "assignment-1",
        driverId: "driver-1",
        status: "ACTIVE"
      }
    });
    await updateOrder(command);
    const secondEventId =
      vi.mocked(enqueueInternalEvent).mock.calls[1]?.[1].eventId;
    expect(secondEventId).not.toBe(firstEventId);
  });

  it("replays an unchanged command without writes or version increments", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      pickupAddress: "取车点",
      deliveryAddress: "送达点",
      currentAssignment: null
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "UNASSIGNED",
      promisedPickupAt: new Date("2026-08-16T08:00:00.000Z"),
      pickupAddress: "取车点",
      deliveryAddress: "送达点",
      currentAssignment: null
    });

    const result = await updateOrder({
      orderId: "order-1",
      pickupAddress: "取车点",
      reason: "重复修改",
      operatorUserId: "dispatcher-1",
      traceId: "trace-replay"
    });

    expect(result).toEqual({
      success: true,
      data: { orderId: "order-1", planVersion: undefined, replayed: true }
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it("does not geocode when only the promised pickup time changes", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      pickupAddress: "取车点",
      deliveryAddress: "送达点",
      currentAssignment: null
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "UNASSIGNED",
      promisedPickupAt: new Date("2026-08-16T08:00:00.000Z"),
      pickupAddress: "取车点",
      pickupLat: 30,
      pickupLng: 120,
      deliveryAddress: "送达点",
      deliveryLat: 31,
      deliveryLng: 121,
      currentAssignment: null
    });

    const result = await updateOrder({
      orderId: "order-1",
      promisedPickupAt: "2026-08-16T09:00:00.000Z",
      reason: "客户改期",
      operatorUserId: "dispatcher-1",
      traceId: "trace-time-only"
    });

    expect(result.success).toBe(true);
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: expect.not.objectContaining({
        pickupLat: expect.anything(),
        deliveryLat: expect.anything()
      })
    });
  });

  it("returns dependency unavailable without entering a transaction when geocoding fails", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      pickupAddress: "旧取车点",
      deliveryAddress: "旧送达点",
      currentAssignment: { id: "assignment-1", driverId: "driver-1" }
    } as never);
    vi.mocked(geocodeAddress).mockResolvedValue({
      success: false,
      code: "GEOCODE_FAILED",
      message: "failed",
      geocodeStatus: "FAILED"
    });

    const result = await updateOrder({
      orderId: "order-1",
      pickupAddress: "新取车点",
      reason: "客户改址",
      operatorUserId: "dispatcher-1",
      traceId: "trace-geocode-fail"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "DEPENDENCY_UNAVAILABLE",
        details: { dependency: "AMAP" }
      })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
    expect(processInternalEvent).not.toHaveBeenCalled();
  });
});

describe("cancelOrder", () => {
  it("cancels an unassigned order and still emits the order cancellation event", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      currentAssignment: null
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "UNASSIGNED",
      currentAssignment: null
    });

    const result = await cancelOrder({
      orderId: "order-1",
      reason: "客户取消",
      operatorUserId: "dispatcher-1",
      traceId: "trace-cancel"
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ orderId: "order-1", replayed: false })
    });
    expect(tx.dispatchAlert.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "OPEN" },
      data: expect.objectContaining({
        status: "RESOLVED",
        resolvedBy: "ORDER_CANCELLED"
      })
    });
    expect(enqueueInternalEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventId: "order-cancelled:order-1",
        type: "ORDER_CANCELLED",
        orderId: "order-1"
      })
    );
  });

  it("rejects cancellation after service starts without side effects", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      currentAssignment: { id: "assignment-1", driverId: "driver-1" }
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "IN_SERVICE",
      currentAssignment: {
        id: "assignment-1",
        driverId: "driver-1",
        status: "ACTIVE"
      }
    });

    const result = await cancelOrder({
      orderId: "order-1",
      reason: "非法取消",
      operatorUserId: "dispatcher-1",
      traceId: "trace-illegal"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: "ILLEGAL_TRANSITION",
        details: { currentStatus: "IN_SERVICE", targetStatus: "CANCELLED" }
      })
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(enqueueInternalEvent).not.toHaveBeenCalled();
  });

  it("returns an internal error when the outbox write aborts the transaction", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      currentAssignment: null
    } as never);
    const tx = transactionMock();
    runTransaction(tx);
    tx.order.findUnique.mockResolvedValue({
      id: "order-1",
      executionStatus: "UNASSIGNED",
      currentAssignment: null
    });
    vi.mocked(enqueueInternalEvent).mockRejectedValue(new Error("outbox down"));

    const result = await cancelOrder({
      orderId: "order-1",
      reason: "客户取消",
      operatorUserId: "dispatcher-1",
      traceId: "trace-outbox-fail"
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: "INTERNAL_ERROR" })
    });
  });
});

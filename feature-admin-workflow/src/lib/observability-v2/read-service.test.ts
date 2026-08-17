import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dispatchAlert: { count: vi.fn(), findMany: vi.fn() },
    operationLog: { count: vi.fn(), findMany: vi.fn() }
  }
}));

import { prisma } from "@/lib/prisma";

import { listAlerts, listOperationLogs } from "./read-service";

describe("observability V2 read service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns OPEN and RESOLVED alert history with stable pagination", async () => {
    vi.mocked(prisma.dispatchAlert.count).mockResolvedValue(1);
    vi.mocked(prisma.dispatchAlert.findMany).mockResolvedValue([
      {
        id: "alert-1",
        orderId: "order-1",
        type: "INFEASIBLE",
        status: "RESOLVED",
        slackMinutesAtCreate: -42,
        resolvedAt: new Date("2026-08-16T04:00:00.000Z"),
        resolvedBy: "SYSTEM_RECALC",
        createdAt: new Date("2026-08-16T03:00:00.000Z"),
        updatedAt: new Date("2026-08-16T04:00:00.000Z")
      }
    ]);

    const result = await listAlerts({
      page: 2,
      pageSize: 10,
      status: "RESOLVED"
    });

    expect(prisma.dispatchAlert.findMany).toHaveBeenCalledWith({
      where: { status: "RESOLVED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10
    });
    expect(result).toEqual({
      items: [
        {
          id: "alert-1",
          orderId: "order-1",
          type: "INFEASIBLE",
          status: "RESOLVED",
          slackMinutesAtCreate: -42,
          createdAt: "2026-08-16T03:00:00.000Z",
          resolvedAt: "2026-08-16T04:00:00.000Z",
          resolvedBy: "SYSTEM_RECALC",
          historyRetained: true
        }
      ],
      total: 1,
      page: 2,
      pageSize: 10
    });
  });

  it("maps only whitelisted scalar changes and never exposes metadataJson", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(1);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        id: "log-1",
        entityType: "ORDER",
        entityId: "order-1",
        action: "ORDER_MODIFY",
        reason: "调整取车信息",
        traceId: "trace-order-1",
        orderId: "order-1",
        driverId: null,
        assignmentId: null,
        metadataJson: {
          before: {
            pickupAddress: "旧地址",
            modules: ["WASHING"],
            secretToken: "must-not-leak",
            pickupLat: { raw: 30.1 }
          },
          after: {
            pickupAddress: "新地址",
            modules: ["WASHING", "REFUELING"],
            secretToken: "still-secret",
            pickupLat: { raw: 30.2 }
          },
          rawPayload: { customerPhone: "13800000000" }
        },
        createdAt: new Date("2026-08-16T05:00:00.000Z"),
        operatorUser: { id: "user-1", name: "调度员甲" }
      }
    ] as never);

    const result = await listOperationLogs({
      page: 1,
      pageSize: 20,
      orderId: "order-1",
      traceId: "trace-order-1",
      action: "ORDER_MODIFY"
    });

    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: "order-1",
          driverId: undefined,
          traceId: "trace-order-1",
          action: "ORDER_MODIFY"
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20
      })
    );
    expect(result.items[0]).toEqual({
      id: "log-1",
      entityType: "ORDER",
      entityId: "order-1",
      action: "ORDER_MODIFY",
      operator: { id: "user-1", name: "调度员甲" },
      reason: "调整取车信息",
      traceId: "trace-order-1",
      orderId: "order-1",
      changes: [
        {
          field: "modules",
          before: ["WASHING"],
          after: ["WASHING", "REFUELING"]
        },
        { field: "pickupAddress", before: "旧地址", after: "新地址" }
      ],
      createdAt: "2026-08-16T05:00:00.000Z"
    });
    expect(result.items[0]).not.toHaveProperty("metadataJson");
  });

  it("normalizes reassignment aliases into public before and after values", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(1);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        id: "log-2",
        entityType: "ASSIGNMENT",
        entityId: "assignment-2",
        action: "REASSIGN",
        reason: null,
        traceId: null,
        orderId: "order-2",
        driverId: "driver-new",
        assignmentId: "assignment-2",
        metadataJson: {
          fromDriverId: "driver-old",
          toDriverId: "driver-new",
          expectedFromPlanVersion: 4,
          expectedToPlanVersion: 9,
          nextFromPlanVersion: 5,
          nextToPlanVersion: 10,
          sourcePlan: [{ internal: true }]
        },
        createdAt: new Date("2026-08-16T06:00:00.000Z"),
        operatorUser: { id: "user-2", name: "调度员乙" }
      }
    ] as never);

    const result = await listOperationLogs({ page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      reason: null,
      traceId: null,
      orderId: "order-2",
      driverId: "driver-new",
      assignmentId: "assignment-2",
      changes: [
        {
          field: "driverId",
          before: "driver-old",
          after: "driver-new"
        },
        {
          field: "planVersion",
          before: [4, 9],
          after: [5, 10]
        }
      ]
    });
  });

  it("normalizes import, automatic dispatch, and module changes", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(3);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        id: "log-import",
        entityType: "ORDER",
        entityId: "order-import",
        action: "IMPORT",
        reason: "来源入单创建",
        traceId: "trace-import",
        orderId: "order-import",
        driverId: null,
        assignmentId: null,
        metadataJson: {
          sourceVersion: "2026-08-16T07:00:00.000Z",
          executionStatus: "UNASSIGNED",
          externalSourcePayload: { private: true }
        },
        createdAt: new Date("2026-08-16T07:00:00.000Z"),
        operatorUser: { id: "system", name: "系统" }
      },
      {
        id: "log-auto",
        entityType: "ASSIGNMENT",
        entityId: "assignment-auto",
        action: "AUTO_DISPATCH",
        reason: "自动排程提交",
        traceId: "trace-auto",
        orderId: "order-auto",
        driverId: "driver-auto",
        assignmentId: "assignment-auto",
        metadataJson: { sequenceNo: 2, internalEtaDebug: { seconds: 90 } },
        createdAt: new Date("2026-08-16T08:00:00.000Z"),
        operatorUser: { id: "system", name: "系统" }
      },
      {
        id: "log-modules",
        entityType: "SERVICE_PLAN",
        entityId: "service-plan-1",
        action: "MODULE_CHANGE",
        reason: "现场增加洗车",
        traceId: "trace-modules",
        orderId: "order-modules",
        driverId: "driver-modules",
        assignmentId: "assignment-modules",
        metadataJson: {
          beforeModules: ["REFUELING"],
          afterModules: ["REFUELING", "WASHING"]
        },
        createdAt: new Date("2026-08-16T09:00:00.000Z"),
        operatorUser: { id: "driver-user", name: "司机甲" }
      }
    ] as never);

    const result = await listOperationLogs({ page: 1, pageSize: 20 });

    expect(result.items.map((item) => item.changes)).toEqual([
      [
        {
          field: "executionStatus",
          before: null,
          after: "UNASSIGNED"
        },
        {
          field: "sourceVersion",
          before: null,
          after: "2026-08-16T07:00:00.000Z"
        }
      ],
      [
        { field: "driverId", before: null, after: "driver-auto" },
        { field: "sequenceNo", before: null, after: 2 }
      ],
      [
        {
          field: "modules",
          before: ["REFUELING"],
          after: ["REFUELING", "WASHING"]
        }
      ]
    ]);
    expect(result.items.map((item) => item.traceId)).toEqual([
      "trace-import",
      "trace-auto",
      "trace-modules"
    ]);
  });

  it("does not treat SHIFT_START driver context as a driver change", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(1);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        id: "log-shift-start",
        entityType: "DRIVER_SHIFT",
        entityId: "shift-1",
        action: "SHIFT_START",
        reason: "Driver shift started",
        traceId: "trace-shift-start",
        orderId: null,
        driverId: "driver-1",
        assignmentId: null,
        metadataJson: {
          shiftId: "shift-1",
          driverId: "driver-1",
          actor: "DRIVER_API",
          occurredAt: "2026-08-16T10:00:00.000Z"
        },
        createdAt: new Date("2026-08-16T10:00:00.000Z"),
        operatorUser: { id: "system", name: "系统" }
      }
    ] as never);

    const result = await listOperationLogs({ page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      action: "SHIFT_START",
      driverId: "driver-1",
      changes: []
    });
  });

  it("reports only sourceVersion when source cancellation needs follow-up without a status change", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(1);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([
      {
        id: "log-follow-up",
        entityType: "ORDER",
        entityId: "order-follow-up",
        action: "ORDER_MODIFY",
        reason: "来源取消但订单 IN_SERVICE/COMPLETED 需人工跟进",
        traceId: "trace-follow-up",
        orderId: "order-follow-up",
        driverId: null,
        assignmentId: null,
        metadataJson: {
          sourceSystem: "HALUO",
          externalOrderId: "HALUO-001",
          beforeVersion: "2026-08-16T10:00:00.000Z",
          afterVersion: "2026-08-16T11:00:00.000Z",
          executionStatus: "IN_SERVICE",
          followUpRequired: true
        },
        createdAt: new Date("2026-08-16T11:00:00.000Z"),
        operatorUser: { id: "system", name: "系统" }
      }
    ] as never);

    const result = await listOperationLogs({ page: 1, pageSize: 20 });

    expect(result.items[0].changes).toEqual([
      {
        field: "sourceVersion",
        before: "2026-08-16T10:00:00.000Z",
        after: "2026-08-16T11:00:00.000Z"
      }
    ]);
  });

  it("returns an empty page instead of treating no logs as an error", async () => {
    vi.mocked(prisma.operationLog.count).mockResolvedValue(0);
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([]);

    await expect(
      listOperationLogs({ page: 1, pageSize: 20, driverId: "missing" })
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});

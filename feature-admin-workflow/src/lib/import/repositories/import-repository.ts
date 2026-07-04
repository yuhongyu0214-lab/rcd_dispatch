import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { ImportPreparedRow, StoredImportMetadata } from "@/lib/import/types";

export async function findStoresByCodes(storeCodes: string[]) {
  return prisma.store.findMany({
    where: {
      code: {
        in: storeCodes
      }
    },
    select: {
      id: true,
      code: true,
      name: true
    }
  });
}

export async function findExistingOrders(orderNos: string[]) {
  return prisma.order.findMany({
    where: {
      orderNo: {
        in: orderNos
      }
    },
    select: {
      orderNo: true
    }
  });
}

export async function findVehiclesByLicensePlates(licensePlates: string[]) {
  return prisma.vehicle.findMany({
    where: {
      licensePlate: {
        in: licensePlates
      }
    },
    select: {
      id: true,
      storeId: true,
      licensePlate: true
    }
  });
}

export async function persistImportBatch(params: {
  rows: ImportPreparedRow[];
  batchId: string;
  operatorUserId: string;
  metadata: StoredImportMetadata;
}) {
  const { rows, batchId, operatorUserId, metadata } = params;

  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.order.create({
        data: {
          orderNo: row.orderId,
          type: row.orderType,
          status: "PENDING",
          storeId: row.storeDbId,
          vehicleId: row.vehicleId,
          licensePlateSnapshot: row.licensePlate,
          importBatchId: batchId,
          channel: row.channel,
          driverNameSnapshot: row.driverName,
          vehicleTypeSnapshot: row.vehicleType,
          pickupAddress: row.pickupAddress,
          pickupLat: row.pickupLat,
          pickupLng: row.pickupLng,
          returnAddress: row.returnAddress,
          returnLat: row.returnLat,
          returnLng: row.returnLng,
          scheduledAt: row.scheduledAt
        }
      });
    }

    await tx.operationLog.create({
      data: {
        entityType: "IMPORT_BATCH",
        entityId: batchId,
        action: "IMPORT",
        operatorUserId,
        metadataJson: metadata as Prisma.InputJsonValue
      }
    });
  });
}

export async function findImportLogByBatchId(batchId: string) {
  return prisma.operationLog.findFirst({
    where: {
      entityType: "IMPORT_BATCH",
      entityId: batchId,
      action: "IMPORT"
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      createdAt: true,
      metadataJson: true
    }
  });
}

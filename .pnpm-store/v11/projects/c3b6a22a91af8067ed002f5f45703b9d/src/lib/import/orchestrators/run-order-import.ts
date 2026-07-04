import { ORDER_TYPES } from "@/types";
import {
  IMPORT_FIELD_LABELS,
  IMPORT_REQUIRED_FIELDS,
  SUGGESTED_VEHICLE_TYPES
} from "@/lib/import/constants";
import {
  findExistingOrders,
  findStoresByCodes,
  findVehiclesByLicensePlates,
  persistImportBatch
} from "@/lib/import/repositories/import-repository";
import { createImportBatchId } from "@/lib/import/services/batch-id";
import { geocodeAddress } from "@/lib/import/services/geocode";
import { parseXlsxRows } from "@/lib/import/sources/xlsx";
import type {
  ImportFeedbackRow,
  ImportIssue,
  ImportPreparedRow,
  ImportRowInput,
  ImportSummary,
  StoredImportMetadata
} from "@/lib/import/types";

function createIssue(params: Omit<ImportIssue, "severity" | "orderId"> & { severity?: ImportIssue["severity"]; orderId?: string | null }) {
  return {
    severity: "ERROR" as const,
    orderId: null,
    ...params
  };
}

function parseScheduledAt(text: string) {
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const value = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );

  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return value;
}

function groupIssuesByRow(issues: ImportIssue[]) {
  const grouped = new Map<number, ImportIssue[]>();

  for (const issue of issues) {
    const existing = grouped.get(issue.rowNumber) ?? [];
    existing.push(issue);
    grouped.set(issue.rowNumber, existing);
  }

  return grouped;
}

function toFeedbackRows(grouped: Map<number, ImportIssue[]>) {
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, issues]) => ({
      rowNumber,
      orderId: issues[0]?.orderId ?? null,
      issues
    })) satisfies ImportFeedbackRow[];
}

function validateBasicRows(rows: ImportRowInput[]) {
  const issues: ImportIssue[] = [];
  const validRows: Array<
    ImportRowInput & {
      parsedScheduledAt: Date;
      normalizedOrderType: (typeof ORDER_TYPES)[number];
    }
  > = [];
  const orderNoRows = new Map<string, number>();

  for (const row of rows) {
    const rowIssues: ImportIssue[] = [];

    for (const field of IMPORT_REQUIRED_FIELDS) {
      const value = row[field];

      if (!value || value.trim() === "") {
        rowIssues.push(
          createIssue({
            rowNumber: row.rowNumber,
            field,
            code: "REQUIRED_FIELD_MISSING",
            message: `第 ${row.rowNumber} 行，字段 ${IMPORT_FIELD_LABELS[field]} 缺失`,
            orderId: row.orderId || null
          })
        );
      }
    }

    if (row.orderType && !ORDER_TYPES.includes(row.orderType as (typeof ORDER_TYPES)[number])) {
      rowIssues.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "orderType",
          code: "INVALID_ORDER_TYPE",
          message: `第 ${row.rowNumber} 行，订单类型不合法`,
          orderId: row.orderId || null
        })
      );
    }

    const scheduledAt = row.scheduledAt ? parseScheduledAt(row.scheduledAt) : null;

    if (row.scheduledAt && !scheduledAt) {
      rowIssues.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "scheduledAt",
          code: "INVALID_DATETIME",
          message: `第 ${row.rowNumber} 行，scheduledAt 格式错误，应为 YYYY-MM-DD HH:mm:ss`,
          orderId: row.orderId || null
        })
      );
    }

    if (row.orderId) {
      const duplicateRow = orderNoRows.get(row.orderId);

      if (duplicateRow) {
        rowIssues.push(
          createIssue({
            rowNumber: row.rowNumber,
            field: "orderId",
            code: "DUPLICATE_IN_FILE",
            message: `第 ${row.rowNumber} 行，订单号与第 ${duplicateRow} 行重复`,
            orderId: row.orderId
          })
        );
      } else {
        orderNoRows.set(row.orderId, row.rowNumber);
      }
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    validRows.push({
      ...row,
      parsedScheduledAt: scheduledAt as Date,
      normalizedOrderType: row.orderType as (typeof ORDER_TYPES)[number]
    });
  }

  return { issues, validRows };
}

export async function runOrderImport(params: {
  fileName: string;
  fileBuffer: Buffer;
  operatorUserId: string;
}) {
  const { fileBuffer, fileName, operatorUserId } = params;
  const parsed = parseXlsxRows(fileBuffer);

  if (!parsed.success) {
    const failedRows = toFeedbackRows(groupIssuesByRow(parsed.issues));

    return {
      batchId: "",
      importedAt: new Date().toISOString(),
      totalCount: 0,
      successCount: 0,
      failureCount: failedRows.length,
      warningCount: 0,
      failedRows,
      warningRows: []
    } satisfies ImportSummary;
  }

  const { issues: basicIssues, validRows } = validateBasicRows(parsed.rows);
  const storeCodes = Array.from(new Set(validRows.map((row) => row.storeId)));
  const orderNos = Array.from(new Set(validRows.map((row) => row.orderId)));
  const licensePlates = Array.from(new Set(validRows.map((row) => row.licensePlate)));

  const [stores, existingOrders, vehicles] = await Promise.all([
    findStoresByCodes(storeCodes),
    findExistingOrders(orderNos),
    findVehiclesByLicensePlates(licensePlates)
  ]);

  const storeMap = new Map(stores.map((store) => [store.code, store]));
  const existingOrderSet = new Set(existingOrders.map((order) => order.orderNo));
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.licensePlate, vehicle]));

  const failedIssues = [...basicIssues];
  const warningIssues: ImportIssue[] = [];
  const preparedRows: ImportPreparedRow[] = [];

  for (const row of validRows) {
    const rowIssues: ImportIssue[] = [];
    const rowWarnings: ImportIssue[] = [];
    const store = storeMap.get(row.storeId);

    if (!store) {
      rowIssues.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "storeId",
          code: "STORE_NOT_FOUND",
          message: `第 ${row.rowNumber} 行，门店编码不存在`,
          orderId: row.orderId
        })
      );
    }

    if (existingOrderSet.has(row.orderId)) {
      rowIssues.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "orderId",
          code: "DUPLICATE_IN_DATABASE",
          message: `第 ${row.rowNumber} 行，订单号已存在`,
          orderId: row.orderId
        })
      );
    }

    if (
      row.vehicleType &&
      !SUGGESTED_VEHICLE_TYPES.includes(row.vehicleType as (typeof SUGGESTED_VEHICLE_TYPES)[number])
    ) {
      rowWarnings.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "vehicleType",
          code: "VEHICLE_TYPE_UNRECOGNIZED",
          message: `第 ${row.rowNumber} 行，车型未命中建议值，将按原始文本入库`,
          severity: "WARNING",
          orderId: row.orderId
        })
      );
    }

    let vehicleId: string | null = null;
    const vehicle = vehicleMap.get(row.licensePlate);

    if (vehicle && store && vehicle.storeId === store.id) {
      vehicleId = vehicle.id;
    } else if (vehicle && store && vehicle.storeId !== store.id) {
      rowWarnings.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "licensePlate",
          code: "VEHICLE_STORE_MISMATCH",
          message: `第 ${row.rowNumber} 行，车辆所属门店与订单门店不一致，已仅保留车牌快照`,
          severity: "WARNING",
          orderId: row.orderId
        })
      );
    }

    if (rowIssues.length > 0 || !store) {
      failedIssues.push(...rowIssues);
      continue;
    }

    const [pickupGeocode, returnGeocode] = await Promise.all([
      geocodeAddress(row.pickupAddress, "取车地址"),
      geocodeAddress(row.returnAddress, "还车地址")
    ]);
    let pickupLat: number | null = null;
    let pickupLng: number | null = null;
    let returnLat: number | null = null;
    let returnLng: number | null = null;

    if (pickupGeocode.success) {
      pickupLat = pickupGeocode.lat;
      pickupLng = pickupGeocode.lng;
    } else {
      rowWarnings.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "pickupAddress",
          code: pickupGeocode.code,
          message: `第 ${row.rowNumber} 行，${pickupGeocode.message}`,
          severity: "WARNING",
          orderId: row.orderId
        })
      );
    }

    if (returnGeocode.success) {
      returnLat = returnGeocode.lat;
      returnLng = returnGeocode.lng;
    } else {
      rowWarnings.push(
        createIssue({
          rowNumber: row.rowNumber,
          field: "returnAddress",
          code: returnGeocode.code,
          message: `第 ${row.rowNumber} 行，${returnGeocode.message}`,
          severity: "WARNING",
          orderId: row.orderId
        })
      );
    }

    warningIssues.push(...rowWarnings);
    preparedRows.push({
      rowNumber: row.rowNumber,
      orderId: row.orderId,
      orderType: row.normalizedOrderType,
      storeDbId: store.id,
      storeCode: store.code,
      vehicleId,
      licensePlate: row.licensePlate,
      channel: row.channel,
      driverName: row.driverName,
      vehicleType: row.vehicleType,
      pickupAddress: row.pickupAddress,
      pickupLat,
      pickupLng,
      returnAddress: row.returnAddress,
      returnLat,
      returnLng,
      scheduledAt: row.parsedScheduledAt,
      warnings: rowWarnings
    });
  }

  const batchId = createImportBatchId();
  const importedAt = new Date().toISOString();
  const failedRows = toFeedbackRows(groupIssuesByRow(failedIssues));
  const warningRows = toFeedbackRows(groupIssuesByRow(warningIssues));
  const metadata: StoredImportMetadata = {
    batchId,
    importedAt,
    fileName,
    sourceType: "XLSX",
    totalCount: parsed.rows.length,
    successCount: preparedRows.length,
    failureCount: failedRows.length,
    warningCount: warningRows.length,
    failedRows,
    warningRows,
    successfulOrderNos: preparedRows.map((row) => row.orderId)
  };

  await persistImportBatch({
    rows: preparedRows,
    batchId,
    operatorUserId,
    metadata
  });

  return {
    batchId,
    importedAt,
    totalCount: parsed.rows.length,
    successCount: preparedRows.length,
    failureCount: failedRows.length,
    warningCount: warningRows.length,
    failedRows,
    warningRows
  } satisfies ImportSummary;
}

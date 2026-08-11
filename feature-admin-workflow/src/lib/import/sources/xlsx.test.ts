import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { IMPORT_REQUIRED_HEADERS } from "@/lib/import/constants";

import { parseXlsxRows } from "./xlsx";

function createWorkbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "订单");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

describe("parseXlsxRows with SheetJS 0.20.3", () => {
  it("reads a valid order import workbook without changing field semantics", () => {
    const buffer = createWorkbookBuffer([
      [...IMPORT_REQUIRED_HEADERS],
      [
        "ORDER-001",
        "DOOR_DELIVERY",
        "STORE-001",
        "SUV",
        "川A12345",
        "HALUO",
        "测试司机",
        "上海市徐汇区取车点",
        "上海市浦东新区还车点",
        "2026-08-05 09:30:00"
      ]
    ]);

    expect(parseXlsxRows(buffer)).toEqual({
      success: true,
      rows: [
        {
          rowNumber: 2,
          orderId: "ORDER-001",
          orderType: "DOOR_DELIVERY",
          storeId: "STORE-001",
          vehicleType: "SUV",
          licensePlate: "川A12345",
          channel: "HALUO",
          driverName: "测试司机",
          pickupAddress: "上海市徐汇区取车点",
          returnAddress: "上海市浦东新区还车点",
          scheduledAt: "2026-08-05 09:30:00"
        }
      ]
    });
  });

  it("keeps rejecting workbooks that miss a required column", () => {
    const headers = IMPORT_REQUIRED_HEADERS.filter(
      (header) => header !== "scheduledAt"
    );
    const buffer = createWorkbookBuffer([[...headers]]);

    expect(parseXlsxRows(buffer)).toMatchObject({
      success: false,
      issues: [
        {
          rowNumber: 1,
          field: "headers",
          code: "TEMPLATE_HEADERS_MISSING",
          severity: "ERROR"
        }
      ]
    });
  });
});

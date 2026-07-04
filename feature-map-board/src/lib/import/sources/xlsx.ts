import * as XLSX from "xlsx";

import { IMPORT_REQUIRED_HEADERS, MAX_IMPORT_ROW_COUNT } from "@/lib/import/constants";
import type { ImportIssue, ImportRowInput } from "@/lib/import/types";

type ParseWorkbookResult =
  | {
      success: true;
      rows: ImportRowInput[];
    }
  | {
      success: false;
      issues: ImportIssue[];
    };

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    const seconds = String(value.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  return String(value).trim();
}

function normalizeScheduledAt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (value instanceof Date) {
    return normalizeText(value);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      const hours = String(parsed.H ?? 0).padStart(2, "0");
      const minutes = String(parsed.M ?? 0).padStart(2, "0");
      const seconds = String(Math.floor(parsed.S ?? 0)).padStart(2, "0");

      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")} ${hours}:${minutes}:${seconds}`;
    }
  }

  return normalizeText(value);
}

export function parseXlsxRows(buffer: Buffer): ParseWorkbookResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return {
      success: false,
      issues: [
        {
          rowNumber: 1,
          field: "file",
          code: "FILE_EMPTY",
          message: "Excel 文件为空或缺少工作表",
          severity: "ERROR",
          orderId: null
        }
      ]
    };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(worksheet, {
    header: 1,
    raw: true,
    defval: ""
  });

  if (matrix.length === 0) {
    return {
      success: false,
      issues: [
        {
          rowNumber: 1,
          field: "file",
          code: "FILE_EMPTY",
          message: "Excel 文件为空，请使用导入模板重新上传",
          severity: "ERROR",
          orderId: null
        }
      ]
    };
  }

  const headers = (matrix[0] ?? []).map((cell) => normalizeText(cell));
  const missingHeaders = IMPORT_REQUIRED_HEADERS.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    return {
      success: false,
      issues: [
        {
          rowNumber: 1,
          field: "headers",
          code: "TEMPLATE_HEADERS_MISSING",
          message: `模板缺少列：${missingHeaders.join("、")}`,
          severity: "ERROR",
          orderId: null
        }
      ]
    };
  }

  const dataRows = matrix.slice(1).filter((row) => row.some((cell) => normalizeText(cell) !== ""));

  if (dataRows.length > MAX_IMPORT_ROW_COUNT) {
    return {
      success: false,
      issues: [
        {
          rowNumber: 1,
          field: "file",
          code: "ROW_LIMIT_EXCEEDED",
          message: `单次导入最多支持 ${MAX_IMPORT_ROW_COUNT} 行数据`,
          severity: "ERROR",
          orderId: null
        }
      ]
    };
  }

  const rows: ImportRowInput[] = dataRows.map((row, index) => {
    const rowMap = new Map<string, string>();

    headers.forEach((header, columnIndex) => {
      rowMap.set(header, normalizeText(row[columnIndex]));
    });

    return {
      rowNumber: index + 2,
      orderId: rowMap.get("orderId") ?? "",
      orderType: rowMap.get("orderType") ?? "",
      storeId: rowMap.get("storeId") ?? "",
      vehicleType: rowMap.get("vehicleType") ?? "",
      licensePlate: rowMap.get("licensePlate") ?? "",
      channel: rowMap.get("channel") ?? "",
      driverName: rowMap.get("driverName") ?? "",
      pickupAddress: rowMap.get("pickupAddress") ?? "",
      returnAddress: rowMap.get("returnAddress") ?? "",
      scheduledAt: normalizeScheduledAt(row[headers.indexOf("scheduledAt")])
    };
  });

  return {
    success: true,
    rows
  };
}

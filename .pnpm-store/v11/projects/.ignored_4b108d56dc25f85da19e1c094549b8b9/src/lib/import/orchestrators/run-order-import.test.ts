import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportRowInput } from "@/lib/import/types";

vi.mock("@/lib/import/sources/xlsx", () => ({
  parseXlsxRows: vi.fn()
}));

vi.mock("@/lib/import/repositories/import-repository", () => ({
  findStoresByCodes: vi.fn(),
  findExistingOrders: vi.fn(),
  findVehiclesByLicensePlates: vi.fn(),
  persistImportBatch: vi.fn()
}));

vi.mock("@/lib/import/services/geocode", () => ({
  geocodeAddress: vi.fn()
}));

vi.mock("@/lib/import/services/batch-id", () => ({
  createImportBatchId: vi.fn()
}));

import { runOrderImport } from "@/lib/import/orchestrators/run-order-import";
import {
  findExistingOrders,
  findStoresByCodes,
  findVehiclesByLicensePlates,
  persistImportBatch
} from "@/lib/import/repositories/import-repository";
import { createImportBatchId } from "@/lib/import/services/batch-id";
import { geocodeAddress } from "@/lib/import/services/geocode";
import { parseXlsxRows } from "@/lib/import/sources/xlsx";

const parseXlsxRowsMock = vi.mocked(parseXlsxRows);
const findStoresByCodesMock = vi.mocked(findStoresByCodes);
const findExistingOrdersMock = vi.mocked(findExistingOrders);
const findVehiclesByLicensePlatesMock = vi.mocked(findVehiclesByLicensePlates);
const persistImportBatchMock = vi.mocked(persistImportBatch);
const geocodeAddressMock = vi.mocked(geocodeAddress);
const createImportBatchIdMock = vi.mocked(createImportBatchId);

function createRow(overrides: Partial<ImportRowInput> = {}): ImportRowInput {
  return {
    rowNumber: 2,
    orderId: "ORD-20260523-001",
    orderType: "STORE_PICKUP",
    storeId: "STORE_SH_HQ",
    vehicleType: "SUV",
    licensePlate: "沪A12345",
    channel: "APP",
    driverName: "张伟",
    pickupAddress: "上海市闵行区申虹路900号",
    returnAddress: "上海市浦东新区张江路100号",
    scheduledAt: "2026-05-23 10:00:00",
    ...overrides
  };
}

describe("runOrderImport", () => {
  beforeEach(() => {
    createImportBatchIdMock.mockReturnValue("IMP_testbatch123");
    findStoresByCodesMock.mockResolvedValue([
      {
        id: "store-1",
        code: "STORE_SH_HQ",
        name: "上海虹桥店"
      }
    ]);
    findExistingOrdersMock.mockResolvedValue([]);
    findVehiclesByLicensePlatesMock.mockResolvedValue([
      {
        id: "vehicle-1",
        storeId: "store-1",
        licensePlate: "沪A12345"
      }
    ]);
    persistImportBatchMock.mockResolvedValue(undefined);
    geocodeAddressMock.mockImplementation(async (_address, addressLabel) => ({
      success: true,
      lat: addressLabel === "取车地址" ? 31.203992 : 31.224361,
      lng: addressLabel === "取车地址" ? 121.31698 : 121.46917
    }));
  });

  it("导入 5 条合法数据时返回全部成功并写入批次", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: Array.from({ length: 5 }, (_, index) =>
        createRow({
          rowNumber: index + 2,
          orderId: `ORD-20260523-10${index + 1}`
        })
      )
    });

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result).toMatchObject({
      batchId: "IMP_testbatch123",
      totalCount: 5,
      successCount: 5,
      failureCount: 0,
      warningCount: 0
    });
    expect(geocodeAddressMock).toHaveBeenCalledTimes(10);
    expect(geocodeAddressMock).toHaveBeenCalledWith(
      "上海市闵行区申虹路900号",
      "取车地址"
    );
    expect(geocodeAddressMock).toHaveBeenCalledWith(
      "上海市浦东新区张江路100号",
      "还车地址"
    );
    expect(persistImportBatchMock).toHaveBeenCalledTimes(1);

    const persistPayload = persistImportBatchMock.mock.calls[0][0];
    expect(persistPayload.operatorUserId).toBe("user-1");
    expect(persistPayload.rows).toHaveLength(5);
    expect(persistPayload.rows[0]).toMatchObject({
      orderId: "ORD-20260523-101",
      orderType: "STORE_PICKUP",
      storeDbId: "store-1",
      vehicleId: "vehicle-1",
      pickupLat: 31.203992,
      pickupLng: 121.31698,
      returnLat: 31.224361,
      returnLng: 121.46917
    });
    expect(persistPayload.metadata).toMatchObject({
      batchId: "IMP_testbatch123",
      totalCount: 5,
      successCount: 5,
      failureCount: 0,
      warningCount: 0,
      successfulOrderNos: [
        "ORD-20260523-101",
        "ORD-20260523-102",
        "ORD-20260523-103",
        "ORD-20260523-104",
        "ORD-20260523-105"
      ]
    });
  });

  it("缺失必填字段时返回具体行号和字段名", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: [
        createRow({
          orderId: "ORD-20260523-201",
          vehicleType: ""
        })
      ]
    });

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0]).toMatchObject({
      rowNumber: 2,
      orderId: "ORD-20260523-201"
    });
    expect(result.failedRows[0].issues[0]).toMatchObject({
      field: "vehicleType",
      code: "REQUIRED_FIELD_MISSING",
      message: "第 2 行，字段 车型 缺失"
    });

    const persistPayload = persistImportBatchMock.mock.calls[0][0];
    expect(persistPayload.rows).toHaveLength(0);
    expect(persistPayload.metadata.failureCount).toBe(1);
  });

  it("数据库已有重复订单时标记失败", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: [createRow()]
    });
    findExistingOrdersMock.mockResolvedValue([{ orderNo: "ORD-20260523-001" }]);

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.failedRows[0].issues[0]).toMatchObject({
      field: "orderId",
      code: "DUPLICATE_IN_DATABASE",
      message: "第 2 行，订单号已存在"
    });
  });

  it("地理编码失败时仍成功入库并记录 warning", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: [createRow({ orderId: "ORD-20260523-301" })]
    });
    geocodeAddressMock.mockImplementation(async (_address, addressLabel) => {
      if (addressLabel === "取车地址") {
        return {
          success: false,
          code: "GEOCODE_FAILED",
          message: "取车地址地理编码失败，已按待补全继续导入"
        };
      }

      return {
        success: true,
        lat: 31.224361,
        lng: 121.46917
      };
    });

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result).toMatchObject({
      successCount: 1,
      failureCount: 0,
      warningCount: 1
    });
    expect(result.warningRows[0].issues[0]).toMatchObject({
      field: "pickupAddress",
      code: "GEOCODE_FAILED"
    });

    const persistPayload = persistImportBatchMock.mock.calls[0][0];
    expect(persistPayload.rows[0]).toMatchObject({
      orderId: "ORD-20260523-301",
      pickupLat: null,
      pickupLng: null,
      returnLat: 31.224361,
      returnLng: 121.46917
    });
  });

  it("还车地址地理编码失败时仍成功入库并记录 warning", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: [createRow({ orderId: "ORD-20260523-302" })]
    });
    geocodeAddressMock.mockImplementation(async (_address, addressLabel) => {
      if (addressLabel === "还车地址") {
        return {
          success: false,
          code: "GEOCODE_FAILED",
          message: "还车地址地理编码失败，已按待补全继续导入"
        };
      }

      return {
        success: true,
        lat: 31.203992,
        lng: 121.31698
      };
    });

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result).toMatchObject({
      successCount: 1,
      failureCount: 0,
      warningCount: 1
    });
    expect(result.warningRows[0].issues[0]).toMatchObject({
      field: "returnAddress",
      code: "GEOCODE_FAILED"
    });

    const persistPayload = persistImportBatchMock.mock.calls[0][0];
    expect(persistPayload.rows[0]).toMatchObject({
      orderId: "ORD-20260523-302",
      pickupLat: 31.203992,
      pickupLng: 121.31698,
      returnLat: null,
      returnLng: null
    });
  });

  it("车辆所属门店不一致时仅保留车牌快照并记录 warning", async () => {
    parseXlsxRowsMock.mockReturnValue({
      success: true,
      rows: [createRow({ orderId: "ORD-20260523-401" })]
    });
    findVehiclesByLicensePlatesMock.mockResolvedValue([
      {
        id: "vehicle-2",
        storeId: "store-2",
        licensePlate: "沪A12345"
      }
    ]);

    const result = await runOrderImport({
      fileName: "orders.xlsx",
      fileBuffer: Buffer.from("fake"),
      operatorUserId: "user-1"
    });

    expect(result).toMatchObject({
      successCount: 1,
      failureCount: 0,
      warningCount: 1
    });
    expect(result.warningRows[0].issues[0]).toMatchObject({
      field: "licensePlate",
      code: "VEHICLE_STORE_MISMATCH"
    });

    const persistPayload = persistImportBatchMock.mock.calls[0][0];
    expect(persistPayload.rows[0]).toMatchObject({
      orderId: "ORD-20260523-401",
      vehicleId: null,
      licensePlate: "沪A12345"
    });
  });
});

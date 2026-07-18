import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ApiFailureV2,
  AssignmentV2,
  CanonicalOrderV2,
  DispatchInputV2,
  DispatchOrderInputV2,
  OrderV2
} from "@/types/v2";

import {
  createApiErrorV2,
  FIXTURE_DISPATCH_INPUT_V2,
  getApiErrorStatusV2,
  SERVICE_MODULE_DURATIONS_MINUTES,
  sumServiceModuleMinutes
} from "./index";

describe("V2 public contracts", () => {
  it("keeps adapter-only and display-only fields outside dispatch input", () => {
    expectTypeOf<CanonicalOrderV2>().toHaveProperty("sourceStatusRaw");
    expectTypeOf<CanonicalOrderV2>().toHaveProperty("licensePlateSnapshot");
    expectTypeOf<OrderV2>().not.toHaveProperty("sourceStatusRaw");
    expectTypeOf<DispatchOrderInputV2>().not.toHaveProperty("sourceStatusRaw");
    expectTypeOf<DispatchOrderInputV2>().not.toHaveProperty(
      "licensePlateSnapshot"
    );
    expectTypeOf<DispatchOrderInputV2>().not.toHaveProperty(
      "vehicleTypeSnapshot"
    );
    expectTypeOf<DispatchInputV2>().not.toHaveProperty("sourceSystem");
  });

  it("keeps planVersion on the driver plan rather than assignment", () => {
    expectTypeOf<AssignmentV2>().not.toHaveProperty("planVersion");
  });

  it("provides a stable dispatch fixture without adapter or vehicle fields", () => {
    expect(FIXTURE_DISPATCH_INPUT_V2.orders[0]).not.toHaveProperty(
      "sourceStatusRaw"
    );
    expect(FIXTURE_DISPATCH_INPUT_V2.orders[0]).not.toHaveProperty(
      "licensePlateSnapshot"
    );
  });

  it("freezes service module durations", () => {
    expect(SERVICE_MODULE_DURATIONS_MINUTES).toEqual({
      CHARGING: 30,
      REFUELING: 5,
      WASHING: 10,
      HANDOVER_FORMALITIES: 10,
      RETURN_FORMALITIES: 5
    });
    expect(sumServiceModuleMinutes(["CHARGING", "WASHING"])).toBe(40);
  });

  it("maps concurrency conflict to 409 with the current plan version", () => {
    const error = createApiErrorV2(
      "PLAN_VERSION_CONFLICT",
      "司机计划版本已变化",
      { currentPlanVersion: 8 }
    );

    expect(getApiErrorStatusV2(error.code)).toBe(409);
    expect(error.details).toEqual({ currentPlanVersion: 8 });
  });

  it("maps reassign conflict to 409 with both current plan versions", () => {
    const error = createApiErrorV2(
      "PLAN_VERSION_CONFLICT",
      "改派涉及的司机计划版本已变化",
      { currentFromPlanVersion: 4, currentToPlanVersion: 7 }
    );

    expect(error.details).toEqual({
      currentFromPlanVersion: 4,
      currentToPlanVersion: 7
    });
  });

  it("maps illegal transition to 400 with current and target status", () => {
    const error = createApiErrorV2("ILLEGAL_TRANSITION", "服务中订单不能取消", {
      currentStatus: "IN_SERVICE",
      targetStatus: "CANCELLED"
    });

    expect(getApiErrorStatusV2(error.code)).toBe(400);
    expect(error.details).toEqual({
      currentStatus: "IN_SERVICE",
      targetStatus: "CANCELLED"
    });
  });

  it("maps dependency failures to 503", () => {
    const error = createApiErrorV2("DEPENDENCY_UNAVAILABLE", "高德暂不可用", {
      dependency: "AMAP"
    });
    const failure: ApiFailureV2<typeof error> = {
      success: false,
      data: null,
      error,
      traceId: "trace-contract-001"
    };

    expect(getApiErrorStatusV2(failure.error.code)).toBe(503);
  });
});

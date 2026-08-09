import { describe, expect, it } from "vitest";

import {
  getTaskNavigationTarget,
  getVisibleDisplayValue
} from "./driver-task-display";

describe("getTaskNavigationTarget", () => {
  it.each([
    ["STORE_PICKUP", "PICKUP"],
    ["DOOR_DELIVERY", "PICKUP"],
    ["STORE_RETURN", "RETURN"],
    ["DOOR_PICKUP", "RETURN"]
  ] as const)("maps %s to the single %s navigation target", (type, target) => {
    expect(getTaskNavigationTarget(type)).toBe(target);
  });

  it("returns null for an unknown business type", () => {
    expect(getTaskNavigationTarget("UNKNOWN")).toBeNull();
  });
});

describe("getVisibleDisplayValue", () => {
  it("hides only values that start with the Gate 3 test marker", () => {
    expect(getVisibleDisplayValue("[G3E2E] 测试订单")).toBeNull();
    expect(getVisibleDisplayValue("普通字段 [G3E2E]")).toBe("普通字段 [G3E2E]");
    expect(getVisibleDisplayValue("普通字段")).toBe("普通字段");
  });

  it("keeps the source value unchanged", () => {
    const source = "[G3E2E] 原始数据";
    getVisibleDisplayValue(source);
    expect(source).toBe("[G3E2E] 原始数据");
  });
});

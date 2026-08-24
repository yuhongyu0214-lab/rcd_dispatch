import { describe, expect, it } from "vitest";

import {
  resolveDialogFieldLabels,
  resolveOperationReason,
  type DialogKind
} from "./dispatcher-console-dialog";

describe("resolveOperationReason", () => {
  it.each<[DialogKind, string]>([
    ["ASSIGN", "调度员人工分配"],
    ["REASSIGN", "调度员人工改派"],
    ["WITHDRAW", "调度员人工撤回"],
    ["UNLOCK", "调度员人工解锁"],
    ["EDIT", "调度员修改订单资料"]
  ])("为空白的 %s 操作补充标准审计原因", (kind, expected) => {
    expect(resolveOperationReason(kind, "  ")).toBe(expected);
  });

  it("保留并清理调度员填写的原因", () => {
    expect(resolveOperationReason("ASSIGN", "  客户临时调整  ")).toBe(
      "客户临时调整"
    );
  });
});

describe("resolveDialogFieldLabels", () => {
  it.each(["STORE_RETURN", "DOOR_PICKUP"] as const)(
    "为 %s 使用还车业务文案",
    (businessType) => {
      expect(resolveDialogFieldLabels(businessType)).toEqual({
        promisedAt: "承诺还车时间（上海时区）",
        pickupAddress: "车辆所在地点",
        deliveryAddress: "还车地点"
      });
    }
  );

  it.each(["STORE_PICKUP", "DOOR_DELIVERY"] as const)(
    "为 %s 使用取车业务文案",
    (businessType) => {
      expect(resolveDialogFieldLabels(businessType)).toEqual({
        promisedAt: "承诺取车时间（上海时区）",
        pickupAddress: "车辆取车地点",
        deliveryAddress: "送车地点"
      });
    }
  );
});

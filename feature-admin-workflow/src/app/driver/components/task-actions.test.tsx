import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

import { TaskActions } from "./task-actions";

vi.stubGlobal("React", React);

const BASE_PROPS = {
  orderId: "order-1",
  orderStatus: "ACCEPTED",
  driverId: "driver-1",
  pickupLat: 31.2304,
  pickupLng: 121.4737,
  returnLat: 31.2204,
  returnLng: 121.4637
};

describe("TaskActions navigation display", () => {
  it.each([
    ["STORE_PICKUP", "导航前往取车", "导航前往还车"],
    ["DOOR_DELIVERY", "导航前往取车", "导航前往还车"],
    ["STORE_RETURN", "导航前往还车", "导航前往取车"],
    ["DOOR_PICKUP", "导航前往还车", "导航前往取车"]
  ] as const)(
    "%s renders only the business-relevant navigation button",
    (businessType, visibleLabel, hiddenLabel) => {
      const html = renderToStaticMarkup(
        <TaskActions {...BASE_PROPS} businessType={businessType} />
      );

      expect(html).toContain(visibleLabel);
      expect(html).not.toContain(hiddenLabel);
    }
  );

  it("pickup business with missing pickup coordinates never leaks a return entry or placeholder", () => {
    const html = renderToStaticMarkup(
      <TaskActions
        {...BASE_PROPS}
        businessType="STORE_PICKUP"
        pickupLat={null}
        pickupLng={null}
      />
    );

    expect(html).toContain("取车坐标缺失");
    expect(html).not.toContain("导航前往还车");
    expect(html).not.toContain("还车坐标缺失");
  });

  it("return business with missing return coordinates never leaks a pickup entry or placeholder", () => {
    const html = renderToStaticMarkup(
      <TaskActions
        {...BASE_PROPS}
        businessType="STORE_RETURN"
        returnLat={null}
        returnLng={null}
      />
    );

    expect(html).toContain("还车坐标缺失");
    expect(html).not.toContain("导航前往取车");
    expect(html).not.toContain("取车坐标缺失");
  });
});

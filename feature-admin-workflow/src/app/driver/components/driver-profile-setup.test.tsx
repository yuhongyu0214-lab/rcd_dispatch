import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() })
}));

import { RegisterForm } from "@/app/admin/register/components/register-form";
import { DriverProfileSetup } from "./driver-profile-setup";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const stores = [{ id: "store-1", code: "A", name: "测试门店" }];

describe("dual workspace account forms", () => {
  it("requires a store at registration and has no role or driver opt-out", () => {
    const html = renderToStaticMarkup(<RegisterForm stores={stores} />);
    expect(html).toContain("同时拥有调度工作台和司机 H5 权限");
    expect(html).toContain("测试门店");
    expect(html).toMatch(/<select[^>]*required/);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("运营管理员");
  });
  it("lets historical unlinked accounts open H5 with setup instead of bouncing home", () => {
    const html = renderToStaticMarkup(<DriverProfileSetup stores={stores} />);
    expect(html).toContain("你的账号已拥有双端权限");
    expect(html).toContain("完成档案并进入任务列表");
    expect(html).toContain('href="/admin/map/v2"');
    expect(html).toContain("min-h-11");
  });
  it("locks a matching driver's original store", () => {
    const html = renderToStaticMarkup(
      <DriverProfileSetup stores={stores} existingStoreId="store-1" />
    );
    expect(html).toMatch(/<select[^>]*disabled/);
    expect(html).toContain("不改变原门店和工作状态");
  });
  it("does not present a submit button for an inactive profile", () => {
    const html = renderToStaticMarkup(
      <DriverProfileSetup stores={stores} blockedReason="档案已停用" />
    );
    expect(html).toContain("档案已停用");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain("打开调度工作台");
  });
});

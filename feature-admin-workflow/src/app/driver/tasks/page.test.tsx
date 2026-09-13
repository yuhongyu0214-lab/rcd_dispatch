import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({ requireDriverPage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() }, driver: { findUnique: vi.fn() }, store: { findMany: vi.fn() } }
}));
vi.mock("../components/driver-workspace", () => ({
  DriverWorkspace: ({ driverId }: { driverId: string }) => <div data-driver-id={driverId}>本人的任务</div>
}));

import { requireDriverPage } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import DriverTasksPage from "./page";

const user = { id: "user-self", email: "self@invalid.example", name: "测试", role: "admin", driverId: null };
const store = { id: "store-own", code: "A", name: "本人门店", isActive: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.mocked(requireDriverPage).mockResolvedValue(user);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ phone: "19900000011" } as never);
  vi.mocked(prisma.driver.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.store.findMany).mockResolvedValue([store] as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("H5 entry identity compatibility", () => {
  it("opens profile setup for an old unlinked admin, querying only its database phone", async () => {
    const html = renderToStaticMarkup(await DriverTasksPage());
    expect(html).toContain("你的账号已拥有双端权限");
    expect(html).toContain("本人门店");
    expect(prisma.driver.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: "19900000011" } }));
    expect(prisma.store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true }, select: { id: true, code: true, name: true }
    }));
  });
  it("keeps a matching existing store instead of selecting a different one", async () => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue({ isActive: true, user: null, store } as never);
    const html = renderToStaticMarkup(await DriverTasksPage());
    expect(html).toContain("已找到同手机号档案");
    expect(html).toMatch(/<select[^>]*disabled/);
    expect(prisma.store.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { isActive: false, user: null, store },
    { isActive: true, user: { id: "other-user" }, store },
    { isActive: true, user: null, store: { ...store, isActive: false } }
  ])("displays blocked profile state instead of a redirect loop: %j", async (driver) => {
    vi.mocked(prisma.driver.findUnique).mockResolvedValue(driver as never);
    const html = renderToStaticMarkup(await DriverTasksPage());
    expect(html).toContain("请联系管理员核对");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain("打开调度工作台");
  });
  it("passes an already linked account's own identity to the existing workspace", async () => {
    vi.mocked(requireDriverPage).mockResolvedValue({ ...user, driverId: "driver-own" });
    const html = renderToStaticMarkup(await DriverTasksPage());
    expect(html).toContain('data-driver-id="driver-own"');
    expect(html).not.toContain("首次使用");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.driver.findUnique).not.toHaveBeenCalled();
  });
});

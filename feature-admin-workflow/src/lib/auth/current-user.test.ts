import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session" }) })
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error("redirect:" + path);
  }
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("./session", () => ({
  AUTH_SESSION_COOKIE_NAME: "dispatch_session",
  verifySessionToken: () => ({ userId: "user-1" })
}));

import { prisma } from "@/lib/prisma";
import { requireAdminPage, requireDriverPage } from "./current-user";
import { isAdminRole, isSystemRole } from "./roles";

beforeEach(() => vi.clearAllMocks());
describe("dual workspace page guards", () => {
  it.each(["admin", "dispatcher", "driver"])(
    "admits registered %s to both workspaces even before profile completion",
    async (role) => {
      const user = {
        id: "user-1",
        email: "test@invalid.example",
        name: "测试",
        role,
        driverId: null
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
      await expect(requireAdminPage("/admin/map")).resolves.toEqual(user);
      await expect(requireDriverPage()).resolves.toEqual(user);
      expect(isAdminRole(role)).toBe(true);
    }
  );
  it.each(["system", "ingest", "unknown", ""])(
    "does not admit %s to human workspaces",
    async (role) => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        role,
        driverId: "driver-1"
      } as never);
      await expect(requireAdminPage("/admin/map")).rejects.toThrow(
        "redirect:/"
      );
      await expect(requireDriverPage()).rejects.toThrow("redirect:/");
      expect(isAdminRole(role)).toBe(false);
    }
  );
  it("keeps anonymous login redirects and system privileges separate", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(requireAdminPage("/admin/map")).rejects.toThrow(
      "redirect:/admin/login?next=%2Fadmin%2Fmap"
    );
    await expect(requireDriverPage()).rejects.toThrow(
      "redirect:/admin/login?next=/driver/tasks"
    );
    expect(isSystemRole("driver")).toBe(false);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storeFindManyMock } = vi.hoisted(() => ({
  storeFindManyMock: vi.fn()
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireAdminPage: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findMany: storeFindManyMock
    }
  }
}));

import AdminPage from "@/app/admin/page";
import AdminLoginPage from "@/app/admin/login/page";
import AdminMapPage from "@/app/admin/map/page";
import AdminOrdersPage from "@/app/admin/orders/page";
import AdminRegisterPage from "@/app/admin/register/page";
import { DispatcherConsole } from "@/app/admin/components/dispatcher-console";
import { DispatcherOrderPool } from "@/app/admin/components/dispatcher-order-pool";
import { getCurrentUser, requireAdminPage } from "@/lib/auth/current-user";

import {
  resolveAdminOrdersDestination,
  resolveSafeLoginPath
} from "./admin-route-policy";

describe("admin route policy", () => {
  it.each([undefined, null, "orders", "unknown", "", ["logs", "orders"]])(
    "retires the default or unsupported order mode %j",
    (mode) => {
      expect(resolveAdminOrdersDestination(mode)).toBe("/admin/orders/v2");
    }
  );

  it.each(["drivers", "vehicles", "alerts", "logs"])(
    "preserves the hidden %s tool and its login return path",
    (mode) => {
      expect(resolveAdminOrdersDestination(mode)).toBeNull();
      const path = `/admin/orders?mode=${mode}`;
      expect(resolveSafeLoginPath(path)).toBe(path);
    }
  );

  it.each([
    ["/admin", "/admin/map/v2"],
    ["/admin/", "/admin/map/v2"],
    ["/admin/map", "/admin/map/v2"],
    ["/admin/map/", "/admin/map/v2"],
    ["/admin/orders", "/admin/orders/v2"],
    ["/admin/orders/?mode=logs", "/admin/orders/v2"],
    ["/admin/orders?mode=logs&extra=1", "/admin/orders/v2"],
    ["/admin/orders?mode=logs&mode=logs", "/admin/orders/v2"],
    ["/admin/orders?mode=%6cogs", "/admin/orders/v2"],
    ["/admin/orders?mode=logs#tool", "/admin/orders/v2"],
    ["/admin/orders?mode=orders", "/admin/orders/v2"],
    ["/admin/orders?mode=unknown", "/admin/orders/v2"],
    ["/admin/orders?mode=logs&mode=orders", "/admin/orders/v2"],
    ["/admin/map/v2", "/admin/map/v2"],
    ["/admin/orders/v2", "/admin/orders/v2"],
    ["/admin/import", "/admin/import"],
    [
      "/admin/import/result?batchId=batch-1",
      "/admin/import/result?batchId=batch-1"
    ],
    ["/driver/tasks", "/driver/tasks"]
  ])("maps %s to %s without a redirect loop", (requested, expected) => {
    expect(resolveSafeLoginPath(requested)).toBe(expected);
    expect(resolveSafeLoginPath(expected)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    "",
    ["/admin/orders/v2", "/admin/login"],
    "/admin/login",
    "/admin/login?next=/admin/login",
    "/admin/register",
    "/administrator",
    "/admin/missing",
    "/admin/map/../login",
    "/admin/%2e%2e/login",
    "/admin/%6cogin",
    "/driver/tasks/another",
    "https://external.example/admin/map",
    "//external.example/admin/map",
    "/\\external.example/admin/map",
    "/admin/map\n",
    "javascript:alert(1)"
  ])("falls back safely for %j", (requested) => {
    expect(resolveSafeLoginPath(requested)).toBe("/admin/map/v2");
  });

  it.each([
    "/admin/map/../orders?mode=logs",
    "/admin/map/%2e%2e/orders?mode=logs",
    "/admin/map/%2E%2E/orders?mode=logs",
    "/admin/map/%2e./orders?mode=logs",
    "/admin/map/.%2e/orders?mode=logs",
    "/admin/map/%2e%2e%2forders?mode=logs",
    "/admin/map/%252e%252e/orders?mode=logs"
  ])("rejects the pre-normalization traversal path %s", (requested) => {
    expect(resolveSafeLoginPath(requested)).toBe("/admin/map/v2");
  });
});

describe("admin page routing and navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubEnv("WORKSPACE_REGISTRATION_INVITE_SECRET", "");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(requireAdminPage).mockReset();
    storeFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects the short admin URL to the guarded V2 page", () => {
    expect(() => AdminPage()).toThrow("REDIRECT:/admin/map/v2");
  });

  it("checks admin access before redirecting the retired map", async () => {
    await expect(AdminMapPage()).rejects.toThrow("REDIRECT:/admin/map/v2");
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/map/v2");
  });

  it.each([undefined, "orders", "unknown", ["logs", "orders"]])(
    "redirects the retired order page mode %j to V2",
    async (mode) => {
      await expect(
        AdminOrdersPage({ searchParams: Promise.resolve({ mode }) })
      ).rejects.toThrow("REDIRECT:/admin/orders/v2");
      expect(requireAdminPage).toHaveBeenCalledWith("/admin/orders/v2");
    }
  );

  it.each(["drivers", "vehicles", "alerts", "logs"])(
    "keeps the hidden %s page and its unauthenticated return destination",
    async (mode) => {
      expect(
        await AdminOrdersPage({ searchParams: Promise.resolve({ mode }) })
      ).toBeTruthy();
      expect(requireAdminPage).toHaveBeenCalledWith(
        `/admin/orders?mode=${mode}`
      );
    }
  );

  it("does not render a hidden tool when the access guard rejects it", async () => {
    vi.mocked(requireAdminPage).mockRejectedValue(new Error("ACCESS_REJECTED"));
    await expect(
      AdminOrdersPage({ searchParams: Promise.resolve({ mode: "logs" }) })
    ).rejects.toThrow("ACCESS_REJECTED");
  });

  it.each([
    ["admin", null, undefined, "/admin/map/v2"],
    ["dispatcher", null, "/admin/map", "/admin/map/v2"],
    ["admin", null, "/admin/login", "/admin/map/v2"],
    ["dispatcher", null, "/admin/orders?mode=logs", "/admin/orders?mode=logs"],
    ["driver", "driver-1", undefined, "/driver/tasks"],
    ["driver", "driver-1", "/admin/map", "/driver/tasks"],
    ["dispatcher", "driver-1", "/driver/tasks", "/driver/tasks"]
  ])(
    "routes an existing %s session to %s",
    async (role, driverId, next, target) => {
      vi.mocked(getCurrentUser).mockResolvedValue({
        id: "test-user",
        email: "test@invalid.example",
        name: "测试用户",
        role,
        driverId: driverId ?? null
      });
      await expect(
        AdminLoginPage({
          searchParams: Promise.resolve({ next: next ?? undefined })
        })
      ).rejects.toThrow(`REDIRECT:${target}`);
    }
  );

  it("renders the login form for an anonymous visitor", async () => {
    const page = await AdminLoginPage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain("后台登录");
  });

  it("shows the invited registration entry when a signing secret is configured", async () => {
    vi.stubEnv(
      "WORKSPACE_REGISTRATION_INVITE_SECRET",
      "test-invitation-secret-with-at-least-32-characters"
    );
    const page = await AdminLoginPage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain("有邀请码，去注册");
  });

  it("keeps the long invited registration form scrollable inside the viewport", async () => {
    vi.stubEnv(
      "WORKSPACE_REGISTRATION_INVITE_SECRET",
      "test-invitation-secret-with-at-least-32-characters"
    );
    const page = await AdminRegisterPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("h-dvh overflow-y-auto");
    expect(html).toContain("账号注册");
  });

  it.each([
    [
      "map",
      () =>
        React.createElement(DispatcherConsole, { entry: "map", amapKey: "" })
    ],
    ["orders", () => React.createElement(DispatcherOrderPool)]
  ] as const)(
    "renders only V2 destinations in the %s navigation",
    (_entry, element) => {
      const html = renderToStaticMarkup(element());
      const navigation = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
      expect(navigation).toContain('href="/admin/map/v2"');
      expect(navigation).toContain('href="/admin/orders/v2"');
      expect(navigation).not.toContain('href="/admin/map"');
      expect(navigation).not.toContain('href="/admin/orders"');
      expect(navigation).not.toContain("V1");
      expect(navigation).not.toContain("/admin/import");
      expect(navigation).not.toContain("mode=");
      expect(navigation).toContain("退出登录");
    }
  );
});

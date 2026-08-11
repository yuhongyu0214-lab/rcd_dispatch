import { describe, expect, it } from "vitest";

import {
  isPublicAdminRegistrationEnabled,
  shouldShowDemoCredentials
} from "./public-registration";

describe("public admin registration policy", () => {
  it("fails closed when the explicit development switch is absent", () => {
    expect(
      isPublicAdminRegistrationEnabled({
        NODE_ENV: "development",
        ALLOW_PUBLIC_ADMIN_REGISTRATION: undefined
      })
    ).toBe(false);
  });

  it("allows public registration only in non-production with the explicit switch", () => {
    expect(
      isPublicAdminRegistrationEnabled({
        NODE_ENV: "development",
        ALLOW_PUBLIC_ADMIN_REGISTRATION: "true"
      })
    ).toBe(true);
  });

  it("keeps public registration disabled in production even when the switch is true", () => {
    expect(
      isPublicAdminRegistrationEnabled({
        NODE_ENV: "production",
        ALLOW_PUBLIC_ADMIN_REGISTRATION: "true"
      })
    ).toBe(false);
  });

  it("hides demo credentials in production", () => {
    expect(shouldShowDemoCredentials({ NODE_ENV: "production" })).toBe(false);
    expect(shouldShowDemoCredentials({ NODE_ENV: "development" })).toBe(true);
  });
});

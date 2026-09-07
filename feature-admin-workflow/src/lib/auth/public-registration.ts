interface AuthSurfaceEnv {
  NODE_ENV?: string;
  ALLOW_PUBLIC_ADMIN_REGISTRATION?: string;
}

export function isPublicAdminRegistrationEnabled(
  env: AuthSurfaceEnv = process.env
): boolean {
  return (
    env.NODE_ENV !== "production" &&
    env.ALLOW_PUBLIC_ADMIN_REGISTRATION === "true"
  );
}

export function shouldShowDemoCredentials(
  env: Pick<AuthSurfaceEnv, "NODE_ENV"> = process.env
): boolean {
  return env.NODE_ENV !== "production";
}

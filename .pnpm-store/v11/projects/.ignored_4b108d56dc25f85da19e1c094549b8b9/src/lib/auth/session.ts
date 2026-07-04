import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_SESSION_COOKIE_NAME = "dispatch_session";
export const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AuthSession = {
  userId: string;
  role: string;
  exp: number;
};

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error("未配置 AUTH_SESSION_SECRET");
  }

  return secret;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function shouldUseSecureCookie() {
  const explicitValue = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

  if (explicitValue === "true") {
    return true;
  }

  if (explicitValue === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

export function createSessionToken(input: { userId: string; role: string; now?: number }) {
  const secret = getSessionSecret();
  const now = input.now ?? Date.now();
  const payload: AuthSession = {
    userId: input.userId,
    role: input.role,
    exp: Math.floor(now / 1000) + AUTH_SESSION_TTL_SECONDS
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string, now?: number): AuthSession | null {
  const secret = getSessionSecret();
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as AuthSession;
    const currentUnixSeconds = Math.floor((now ?? Date.now()) / 1000);

    if (
      !payload.userId ||
      !payload.role ||
      typeof payload.exp !== "number" ||
      payload.exp <= currentUnixSeconds
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    name: AUTH_SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: AUTH_SESSION_TTL_SECONDS
  };
}

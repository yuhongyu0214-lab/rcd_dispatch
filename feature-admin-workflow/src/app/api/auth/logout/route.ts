import { ok } from "@/lib/api-response";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const response = ok({ loggedOut: true }, { traceId });

  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}

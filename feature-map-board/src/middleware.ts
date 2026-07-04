import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TRACE_HEADER = "x-trace-id";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 只拦截 API 路由
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 复用客户端传入的 traceId，没有则生成新的
  const traceId =
    request.headers.get(TRACE_HEADER) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_HEADER, traceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });

  response.headers.set("X-Trace-Id", traceId);

  return response;
}

export const config = {
  matcher: "/api/:path*"
};

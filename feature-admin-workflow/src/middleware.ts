import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 全链路 Trace ID 中间件
 *
 * 为每个 API 请求自动注入 X-Trace-Id，免去路由手写 crypto.randomUUID()。
 * - 客户端可主动传 X-Trace-Id 请求头以串联跨服务调用链
 * - 未传时自动生成 UUID v4
 * - 同时注入到入站请求头（路由内通过 request.headers.get 获取）
 *   和出站响应头（客户端可见）
 *
 * 与 lib/api-response.ts 的 withTraceIdHeaders 互补：
 * - 中间件保证请求到达时 traceId 已就绪
 * - api-response 保证响应体 JSON 内也包含 traceId
 */
export function middleware(request: NextRequest) {
  const traceId =
    request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // 构造新 Headers，注入 X-Trace-Id 供下游路由读取
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("X-Trace-Id", traceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // 设置响应头（与 api-response.ts 的 withTraceIdHeaders 互补）
  response.headers.set("X-Trace-Id", traceId);

  return response;
}

/**
 * 仅拦截 API 路由，避免影响静态资源、NextAuth 页面等。
 */
export const config = {
  matcher: "/api/:path*",
};

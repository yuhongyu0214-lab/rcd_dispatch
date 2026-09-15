import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api-response";
import {
  buildV1WriteGoneCorsHeaders,
  buildV1WriteGoneMessage,
  findV1WriteGuardMatch,
  isV2StateMachineEnabled
} from "@/lib/compatibility/v1-write-guard";
import { ADMIN_ORDERS_V2_PATH } from "@/lib/navigation/admin-route-policy";
import { getOrCreateTraceId } from "@/lib/observability-v2/trace";

const EXACT_LEGACY_TOOL_PATHS = new Set([
  "/admin/orders?mode=drivers",
  "/admin/orders?mode=vehicles",
  "/admin/orders?mode=alerts",
  "/admin/orders?mode=logs"
]);
const ORIGINAL_REQUEST_URI_HEADER = "X-Rcd-Original-Request-Uri";

function getRawPathAndSearch(requestUrl: string) {
  const schemeSeparatorIndex = requestUrl.indexOf("://");
  const pathStartIndex = requestUrl.indexOf("/", schemeSeparatorIndex + 3);

  return pathStartIndex === -1 ? "" : requestUrl.slice(pathStartIndex);
}

function redirectToV2Orders(request: NextRequest) {
  return NextResponse.redirect(new URL(ADMIN_ORDERS_V2_PATH, request.url));
}

function handleAdminOrdersRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname !== "/admin/orders" && pathname !== "/admin/orders/") {
    return null;
  }

  const normalizedPathAndSearch = getRawPathAndSearch(request.url);
  const originalRequestUri = request.headers.get(ORIGINAL_REQUEST_URI_HEADER);
  if (
    originalRequestUri !== null &&
    EXACT_LEGACY_TOOL_PATHS.has(originalRequestUri) &&
    EXACT_LEGACY_TOOL_PATHS.has(normalizedPathAndSearch)
  ) {
    return NextResponse.next();
  }

  return redirectToV2Orders(request);
}

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
  const adminOrdersResponse = handleAdminOrdersRequest(request);
  if (adminOrdersResponse) return adminOrdersResponse;

  const traceId = getOrCreateTraceId(request.headers);
  const v1WriteMatch = findV1WriteGuardMatch(
    request.method,
    request.nextUrl.pathname
  );

  if (
    isV2StateMachineEnabled(process.env.RCD_V2_STATE_MACHINE_ENABLED) &&
    v1WriteMatch
  ) {
    return fail(buildV1WriteGoneMessage(v1WriteMatch), {
      status: 410,
      traceId,
      headers: {
        "Cache-Control": "no-store",
        ...buildV1WriteGoneCorsHeaders(
          v1WriteMatch,
          request.headers.get("Origin"),
          process.env.CORS_ORIGINS
        )
      }
    });
  }

  // 构造新 Headers，注入 X-Trace-Id 供下游路由读取
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("X-Trace-Id", traceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });

  // 设置响应头（与 api-response.ts 的 withTraceIdHeaders 互补）
  response.headers.set("X-Trace-Id", traceId);

  return response;
}

/**
 * 仅拦截 API 与旧订单工具入口，避免影响静态资源和其他页面。
 */
export const config = {
  matcher: ["/api/:path*", "/admin/orders", "/admin/orders/"]
};

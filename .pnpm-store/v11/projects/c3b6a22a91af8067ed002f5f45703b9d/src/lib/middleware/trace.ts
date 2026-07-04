/**
 * traceId 工具 — 贯穿请求全链路的唯一标识。
 *
 * 使用方式：
 * - 中间件（middleware.ts）在请求到达时注入 x-trace-id 请求头
 * - API Route 通过 getTraceId(request) 获取同一个 traceId
 * - traceId 随 ok()/fail() 写入响应体，中间件同步写入 X-Trace-Id 响应头
 */

const TRACE_HEADER = "x-trace-id";

export function getTraceId(request: Request): string {
  return request.headers.get(TRACE_HEADER) ?? crypto.randomUUID();
}

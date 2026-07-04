import { NextResponse } from "next/server";

import type { ApiFailure, ApiSuccess } from "@/types";

type ApiResponseOptions = ResponseInit & {
  traceId?: string;
};

function withTraceIdHeaders(headersInit: HeadersInit | undefined, traceId: string) {
  const headers = new Headers(headersInit);
  headers.set("X-Trace-Id", traceId);
  return headers;
}

export function ok<T>(data: T, options?: ApiResponseOptions) {
  const traceId = options?.traceId ?? crypto.randomUUID();
  const body: ApiSuccess<T> = {
    success: true,
    data,
    error: null,
    traceId
  };

  return NextResponse.json(body, {
    ...options,
    headers: withTraceIdHeaders(options?.headers, traceId)
  });
}

export function fail(error: string, options?: ApiResponseOptions) {
  const traceId = options?.traceId ?? crypto.randomUUID();
  const body: ApiFailure = {
    success: false,
    data: null,
    error,
    traceId
  };

  return NextResponse.json(body, {
    ...options,
    headers: withTraceIdHeaders(options?.headers, traceId)
  });
}

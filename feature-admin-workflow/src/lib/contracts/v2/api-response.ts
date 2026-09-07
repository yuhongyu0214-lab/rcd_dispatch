import { NextResponse } from "next/server";

import type { ApiErrorV2, ApiFailureV2, ApiSuccessV2 } from "@/types/v2";

import { getApiErrorStatusV2 } from "./errors";

type ApiResponseOptionsV2 = Omit<ResponseInit, "status"> & {
  traceId?: string;
};

function withTraceIdHeaders(
  headersInit: HeadersInit | undefined,
  traceId: string
) {
  const headers = new Headers(headersInit);
  headers.set("X-Trace-Id", traceId);
  return headers;
}

export function okV2<T>(
  data: T,
  options?: ApiResponseOptionsV2 & { status?: number }
) {
  const { traceId: providedTraceId, ...responseInit } = options ?? {};
  const traceId = providedTraceId ?? crypto.randomUUID();
  const body: ApiSuccessV2<T> = {
    success: true,
    data,
    error: null,
    traceId
  };

  return NextResponse.json(body, {
    ...responseInit,
    headers: withTraceIdHeaders(responseInit.headers, traceId)
  });
}

export function failV2<E extends ApiErrorV2>(
  error: E,
  options?: ApiResponseOptionsV2
) {
  const { traceId: providedTraceId, ...responseInit } = options ?? {};
  const traceId = providedTraceId ?? crypto.randomUUID();
  const body: ApiFailureV2<E> = {
    success: false,
    data: null,
    error,
    traceId
  };

  return NextResponse.json(body, {
    ...responseInit,
    status: getApiErrorStatusV2(error.code),
    headers: withTraceIdHeaders(responseInit.headers, traceId)
  });
}

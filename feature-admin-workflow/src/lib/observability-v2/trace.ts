const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function getOrCreateTraceId(headers: Pick<Headers, "get">): string {
  const incoming = headers.get("X-Trace-Id");
  return incoming && TRACE_ID_PATTERN.test(incoming)
    ? incoming
    : crypto.randomUUID();
}

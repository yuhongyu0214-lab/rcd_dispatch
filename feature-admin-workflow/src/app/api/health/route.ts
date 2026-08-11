import { ok } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  return ok({ status: "ok" }, { traceId });
}

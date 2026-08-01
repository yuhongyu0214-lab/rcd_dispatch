import { okV2 } from "@/lib/contracts/v2";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  return okV2({ status: "ok" as const }, { traceId });
}

import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return ok({
      status: "ok",
      db: "connected"
    }, { traceId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Database health check failed";

    return fail(message, { status: 500, traceId });
  }
}

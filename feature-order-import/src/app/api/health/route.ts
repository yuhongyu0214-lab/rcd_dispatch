import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const traceId = crypto.randomUUID();

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

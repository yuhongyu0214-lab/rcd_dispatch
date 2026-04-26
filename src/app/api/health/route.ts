import { fail, ok } from "@/lib/api-response";
import { logger } from "@/lib/logger";
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
      error instanceof Error ? error.message : "Database connection failed";

    logger.error("Health check failed", {
      traceId,
      outcome: "FAILED",
      message
    });

    return fail(message, { status: 500, traceId });
  }
}

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      success: true,
      data: {
        status: "ok",
        db: "connected"
      },
      error: null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Database health check failed";

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: message
      },
      { status: 500 }
    );
  }
}

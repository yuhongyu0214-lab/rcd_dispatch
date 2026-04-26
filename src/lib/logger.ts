import pino from "pino";

import type { LogContext } from "@/types";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime
});

function hasContext(context?: LogContext) {
  return Boolean(context && Object.keys(context).length > 0);
}

function writeLog(
  level: "info" | "warn" | "error",
  message: string,
  context?: LogContext
) {
  if (hasContext(context)) {
    pinoLogger[level](context, message);
    return;
  }

  pinoLogger[level](message);
}

export const logger = {
  info(message: string, context?: LogContext) {
    writeLog("info", message, context);
  },

  warn(message: string, context?: LogContext) {
    writeLog("warn", message, context);
  },

  error(message: string, context?: LogContext) {
    writeLog("error", message, context);
  }
};

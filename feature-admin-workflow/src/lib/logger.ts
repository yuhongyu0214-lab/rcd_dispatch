import pino from "pino";

export type LogPayload = Record<string, unknown>;

function normalizePayload(payload: LogPayload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

export function createLogger(scope: string) {
  const scopedLogger = baseLogger.child({ scope });
  return {
    info(message: string, payload: LogPayload = {}) {
      scopedLogger.info(normalizePayload(payload), message);
    },
    warn(message: string, payload: LogPayload = {}) {
      scopedLogger.warn(normalizePayload(payload), message);
    },
    error(message: string, payload: LogPayload = {}) {
      scopedLogger.error(normalizePayload(payload), message);
    }
  };
}

export const logger = createLogger("app");

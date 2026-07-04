export type LogPayload = Record<string, string | number | boolean | null | undefined>;

type LogLevel = "info" | "warn" | "error";

function normalizePayload(payload: LogPayload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function writeLog(level: LogLevel, scope: string, message: string, payload: LogPayload = {}) {
  const line = JSON.stringify({
    level,
    scope,
    message,
    ...normalizePayload(payload),
    timestamp: new Date().toISOString()
  });

  process.stdout.write(`${line}\n`);
}

export function createLogger(scope: string) {
  return {
    info(message: string, payload: LogPayload = {}) {
      writeLog("info", scope, message, payload);
    },
    warn(message: string, payload: LogPayload = {}) {
      writeLog("warn", scope, message, payload);
    },
    error(message: string, payload: LogPayload = {}) {
      writeLog("error", scope, message, payload);
    }
  };
}

export const logger = createLogger("app");

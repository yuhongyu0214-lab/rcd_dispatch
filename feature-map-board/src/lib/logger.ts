import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname"
      }
    }
  })
});

/**
 * 创建带 scope 的子 Logger。
 *
 * Pino 子 Logger 自动将 scope 注入每一条日志，调用方无需手动传 scope。
 */
export function createLogger(scope: string) {
  return rootLogger.child({ scope });
}

/** 默认 Logger（scope = "app"） */
export const logger = createLogger("app");

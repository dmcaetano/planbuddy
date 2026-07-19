type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const line = { level, message, ...meta, ts: new Date().toISOString() };
  // eslint-disable-next-line no-console
  console[level === "info" ? "log" : level](JSON.stringify(line));
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

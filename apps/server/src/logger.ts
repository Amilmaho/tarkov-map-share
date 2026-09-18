/**
 * 结构化日志（每行一条 JSON）。
 *
 * 与协议文档的安全要求一致：`passcode`、`token`、`password` 一律不入日志。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

export type Logger = {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = new Set(["passcode", "token", "password", "secret"]);

function redact(meta: LogMeta): LogMeta {
  const result: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[已脱敏]" : value;
  }
  return result;
}

export type CreateLoggerOptions = {
  level?: LogLevel;
  sink?: (line: string) => void;
  now?: () => number;
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => Date.now());
  const threshold = LEVEL_ORDER[level];

  const write = (entryLevel: LogLevel, message: string, meta?: LogMeta): void => {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const payload: LogMeta = { time: new Date(now()).toISOString(), level: entryLevel, message };
    if (meta !== undefined) payload.meta = redact(meta);
    sink(JSON.stringify(payload));
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}

/** 测试用：不输出任何日志 */
export function createSilentLogger(): Logger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

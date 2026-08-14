type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|credential|api.?key|code)/i;

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL as LogLevel | undefined;
  return value && value in PRIORITY ? value : 'info';
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => {
    if (SENSITIVE_KEY.test(key)) return [key, '[redacted]'];
    if (value instanceof Error) return [key, { name: value.name, message: value.message }];
    return [key, value];
  }));
}

export function log(level: LogLevel, event: string, context: Record<string, unknown> = {}): void {
  if (PRIORITY[level] < PRIORITY[configuredLevel()]) return;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitizeContext(context),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => log('debug', event, context),
  info: (event: string, context?: Record<string, unknown>) => log('info', event, context),
  warn: (event: string, context?: Record<string, unknown>) => log('warn', event, context),
  error: (event: string, context?: Record<string, unknown>) => log('error', event, context),
};

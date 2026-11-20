import type { Clock, LogFields, Logger } from '@/application/ports'

const SECRET_KEY = /token|secret|authorization|password|cookie/i
// Anthropic OAuth tokens (sk-ant-oat01-…, sk-ant-ort01-…) and any Bearer credential.
const SECRET_VALUE = /sk-ant-[\w-]+|(?<=Bearer\s+)[\w.~+/=-]+/g
const MASK = '[redacted]'

/** Deep copy safe to log: token-like keys and token-looking substrings are masked. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, MASK)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return { name: value.name, message: redact(value.message) }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? MASK : redact(v)]),
    )
  }
  return value
}

export interface LogSinks {
  out(line: string): void
  err(line: string): void
}

const stdio: LogSinks = {
  out: (l) => process.stdout.write(l),
  err: (l) => process.stderr.write(l),
}

/** One JSON object per line (journald-friendly). Never logs a token. */
export class JsonLogger implements Logger {
  constructor(
    private readonly clock: Clock,
    private readonly sinks: LogSinks = stdio,
  ) {}

  info(message: string, fields?: LogFields) {
    this.#write('info', message, fields)
  }
  warn(message: string, fields?: LogFields) {
    this.#write('warn', message, fields)
  }
  error(message: string, fields?: LogFields) {
    this.#write('error', message, fields)
  }

  #write(level: string, message: string, fields: LogFields = {}) {
    const line = `${JSON.stringify({
      t: this.clock.now().toISOString(),
      level,
      msg: redact(message),
      ...(redact(fields) as object),
    })}\n`
    if (level === 'error') this.sinks.err(line)
    else this.sinks.out(line)
  }
}

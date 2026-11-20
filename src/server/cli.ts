import { parseArgs } from 'node:util'

export interface CliOptions {
  /** Overrides `$PORT` when set. */
  port: number | undefined
  /** Open the dashboard in the default browser once listening. */
  open: boolean
}

/** `claude-swap [--port <1-65535>] [--open]`; throws on anything else. */
export function parseCli(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: { port: { type: 'string' }, open: { type: 'boolean', default: false } },
  })
  if (values.port === undefined) return { port: undefined, open: values.open }
  const port = Number(values.port)
  if (!/^\d+$/.test(values.port) || port < 1 || port > 65_535)
    throw new Error(`--port must be an integer from 1 to 65535, got "${values.port}"`)
  return { port, open: values.open }
}

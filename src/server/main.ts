import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { version } from '../../package.json'
import { createApp } from './app'
import { type CliOptions, parseCli } from './cli'
import { createContainer } from './container'

let cli: CliOptions
try {
  cli = parseCli(process.argv.slice(2))
} catch (err) {
  console.error(`claude-swap: ${(err as Error).message}\nusage: claude-swap [--port <n>] [--open]`)
  process.exit(2)
}

const container = createContainer(cli.port === undefined ? {} : { port: cli.port })
const { engine, logger, port } = container

const server = serve({ fetch: createApp(container).fetch, hostname: '127.0.0.1', port }, (info) => {
  const url = `http://127.0.0.1:${info.port}`
  logger.info('listening', { url, version, pid: process.pid })
  engine.start()
  if (cli.open) {
    // Linux only (architecture §9); a missing xdg-open must not take the server down.
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
      .on('error', (err) => logger.warn('could not open browser', { err }))
      .unref()
  }
})

server.on('error', (err) => {
  logger.error('server error', { err })
  process.exit(1)
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    logger.info('shutting down', { signal })
    engine.stop()
    server.close(() => process.exit(0))
    // Keep-alive connections can hold close() open; do not hang the service manager.
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}

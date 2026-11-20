import { serve } from '@hono/node-server'
import { version } from '../../package.json'
import { createApp } from './app'
import { createContainer } from './container'

const container = createContainer()
const { engine, logger, port } = container

const server = serve({ fetch: createApp(container).fetch, hostname: '127.0.0.1', port }, (info) => {
  logger.info('listening', { url: `http://127.0.0.1:${info.port}`, version, pid: process.pid })
  engine.start()
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

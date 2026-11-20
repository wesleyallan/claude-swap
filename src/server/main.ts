import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
const port = Number(process.env.PORT ?? 4747)

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(JSON.stringify({ msg: 'listening', url: `http://127.0.0.1:${info.port}` }))
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

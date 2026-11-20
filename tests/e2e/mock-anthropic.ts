// Tiny stand-in for the two Anthropic endpoints claude-swap calls (architecture §3).
// State is keyed by token: an access token for `/api/oauth/usage`, a refresh token for
// `/v1/oauth/token`. Tests change it with `POST /__control`.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockWindow {
  utilization: number
  resetsAt: string | null
}

export interface MockControl {
  token: string
  fiveHour?: MockWindow | null
  sevenDay?: MockWindow | null
  /** Forced failure; `null` clears it. `invalid_grant` applies to the token endpoint. */
  fail?: 401 | 429 | 'invalid_grant' | null
}

type Entry = Omit<MockControl, 'token'>

const json = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : {}
}

const toWire = (w: MockWindow | null) => w && { utilization: w.utilization, resets_at: w.resetsAt }

export async function startMockAnthropic(port = 0) {
  const state = new Map<string, Entry>()
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://mock').pathname
      if (req.method === 'POST' && path === '/__control') {
        const { token, ...patch } = (await readJson(req)) as unknown as MockControl
        state.set(token, { ...state.get(token), ...patch })
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET' && path === '/api/oauth/usage') {
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        const s = state.get(token) ?? {}
        if (s.fail === 401) return json(res, 401, { error: 'unauthorized' })
        if (s.fail === 429)
          return json(res, 429, { error: 'rate_limited' }, { 'retry-after': '60' })
        return json(res, 200, {
          five_hour: toWire(
            s.fiveHour === undefined ? { utilization: 10, resetsAt: inHours(3) } : s.fiveHour,
          ),
          seven_day: toWire(
            s.sevenDay === undefined ? { utilization: 20, resetsAt: inHours(72) } : s.sevenDay,
          ),
          extra_usage: null,
        })
      }
      if (req.method === 'POST' && path === '/v1/oauth/token') {
        const refresh = String((await readJson(req)).refresh_token ?? '')
        const s = state.get(refresh) ?? {}
        if (s.fail === 'invalid_grant') return json(res, 400, { error: 'invalid_grant' })
        if (s.fail === 401) return json(res, 401, { error: 'unauthorized' })
        if (s.fail === 429) return json(res, 429, { error: 'rate_limited' })
        // No rotation: keeps the per-token control entries valid across refreshes.
        return json(res, 200, {
          access_token: `${refresh}-access`,
          refresh_token: refresh,
          expires_in: 8 * 3600,
        })
      }
      json(res, 404, { error: 'not_found' })
    } catch {
      json(res, 400, { error: 'bad_request' })
    }
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    async control(c: MockControl) {
      const res = await fetch(`${url}/__control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(c),
      })
      if (!res.ok) throw new Error(`mock control failed: ${res.status}`)
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export type MockAnthropic = Awaited<ReturnType<typeof startMockAnthropic>>

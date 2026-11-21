import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeClaudeCodeSession,
  FakeClock,
  FakeEngine,
  FakeTokenRefresher,
  FakeUsageApi,
  fakeAccount,
  fakeTokens,
  MemoryConfigRepository,
  MemoryLogger,
  MemorySecretsRepository,
  MemoryStateRepository,
  SimpleMutex,
} from '@/application/testing/fakes'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import { ClaudeCodeFileError } from '@/infrastructure/claude-code/claude-code-session'
import { createApp } from './app'
import { type Container, createContainer } from './container'

const webRoot = mkdtempSync(join(tmpdir(), 'claude-swap-web-'))
mkdirSync(join(webRoot, 'assets'))
writeFileSync(
  join(webRoot, 'index.html'),
  '<!doctype html><html lang="en"><head></head><body><div id="root"></div></body></html>',
)
writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)')
writeFileSync(join(webRoot, 'favicon.svg'), '<svg/>')
afterAll(() => rmSync(webRoot, { recursive: true, force: true }))

const BASE = 'http://127.0.0.1:4747'
const SAME_ORIGIN = { origin: BASE }

let c: Container
let engine: FakeEngine
let config: MemoryConfigRepository
let secrets: MemorySecretsRepository
let session: FakeClaudeCodeSession
let logger: MemoryLogger
let app: ReturnType<typeof createApp>

beforeEach(() => {
  const clock = new FakeClock()
  engine = new FakeEngine()
  config = new MemoryConfigRepository({
    preferences: DEFAULT_PREFERENCES,
    accounts: [fakeAccount('a'), fakeAccount('b')],
  })
  secrets = new MemorySecretsRepository()
  session = new FakeClaudeCodeSession()
  logger = new MemoryLogger()
  c = createContainer(
    {
      clock,
      logger,
      config,
      secrets,
      state: new MemoryStateRepository(),
      session,
      usageApi: new FakeUsageApi(),
      refresher: new FakeTokenRefresher(clock),
      mutex: new SimpleMutex(),
      engine,
      port: 4747,
      webRoot,
    },
    {},
  )
  app = createApp(c)
})

const req = (path: string, init: RequestInit = {}) => app.request(`${BASE}${path}`, init)
const json = (method: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

describe('security middleware', () => {
  it('rejects a foreign Host (DNS rebinding)', async () => {
    const res = await app.request('http://evil.test:4747/api/health')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden-host' })
  })

  it('rejects the right host on the wrong port', async () => {
    expect((await app.request('http://localhost:9999/api/health')).status).toBe(403)
  })

  it('accepts localhost and 127.0.0.1 with the port', async () => {
    expect((await app.request('http://localhost:4747/api/health')).status).toBe(200)
    expect((await req('/api/health')).status).toBe(200)
  })

  it('rejects a cross-origin mutation (CSRF)', async () => {
    const res = await req('/api/engine/run', {
      method: 'POST',
      headers: { origin: 'http://evil.test' },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden-origin' })
    expect(engine.runs).toEqual([])
  })

  it('rejects Origin: null and an allowed host with another port', async () => {
    for (const origin of ['null', 'http://127.0.0.1:5173']) {
      expect((await req('/api/engine/run', { method: 'POST', headers: { origin } })).status).toBe(
        403,
      )
    }
  })

  it('allows a mutation without Origin (non-browser client) and same-origin', async () => {
    expect((await req('/api/engine/run', { method: 'POST' })).status).toBe(200)
    expect((await req('/api/engine/run', { method: 'POST', headers: SAME_ORIGIN })).status).toBe(
      200,
    )
  })

  it('sets secure headers', async () => {
    const res = await req('/api/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('sends a same-origin CSP: no inline or foreign scripts, inline styles allowed', async () => {
    const csp = (await req('/')).headers.get('content-security-policy') ?? ''
    const directives = Object.fromEntries(
      csp.split(';').map((d) => {
        const [name = '', ...values] = d.trim().split(/\s+/)
        return [name, values.join(' ')]
      }),
    )
    expect(directives).toMatchObject({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'object-src': "'none'",
      'base-uri': "'none'",
      'frame-ancestors': "'none'",
    })
  })
})

describe('api', () => {
  it('GET /health', async () => {
    expect(await (await req('/api/health')).json()).toEqual({ status: 'ok' })
  })

  it('GET /dashboard returns the DTO, never tokens, with the unknown login', async () => {
    await secrets.set('a', fakeTokens('a', 0))
    engine.current = { ...engine.current, unknownLogin: 'stranger@example.test' }
    const res = await req('/api/dashboard')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accounts.map((a: { id: string }) => a.id)).toEqual(['a', 'b'])
    expect(body.engine.unknownLogin).toBe('stranger@example.test')
    expect(JSON.stringify(body)).not.toMatch(/fake-(access|refresh)|oauthAccount|token/i)
  })

  it('GET /history returns the points apart from the dashboard', async () => {
    const t = new Date('2026-11-19T12:00:00.000Z')
    await c.state.save({
      ...(await c.state.load()),
      history: [{ t, accountId: 'a', fiveHour: 40, sevenDay: 10 }],
    })
    expect(await (await req('/api/history')).json()).toEqual([
      { t: t.toISOString(), accountId: 'a', fiveHour: 40, sevenDay: 10 },
    ])
    expect(await (await req('/api/dashboard')).json()).not.toHaveProperty('history')
  })

  it('gzips large JSON responses when the client accepts it', async () => {
    const t = new Date('2026-11-19T12:00:00.000Z')
    const history = Array.from({ length: 200 }, (_, i) => ({
      t: new Date(t.getTime() + i * 1000),
      accountId: 'a',
      fiveHour: i % 100,
      sevenDay: null,
    }))
    await c.state.save({ ...(await c.state.load()), history })
    const res = await req('/api/history', { headers: { 'accept-encoding': 'gzip' } })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    const body = await new Response(res.body?.pipeThrough(new DecompressionStream('gzip'))).json()
    expect(body).toHaveLength(200)
  })

  it('POST /accounts/import imports the live login', async () => {
    session.live = {
      oauth: fakeTokens('c', 0),
      account: { accountUuid: 'c', emailAddress: 'c@example.test' },
    }
    const res = await req('/api/accounts/import', { method: 'POST', headers: SAME_ORIGIN })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ id: 'c', email: 'c@example.test' })
    expect(JSON.stringify(body)).not.toMatch(/fake-|token|oauth/i)
    expect(config.data.accounts.map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('POST /accounts/import takes an optional label (validated)', async () => {
    session.live = {
      oauth: fakeTokens('c', 0),
      account: { accountUuid: 'c', emailAddress: 'c@example.test' },
    }
    const post = (body: unknown) =>
      req('/api/accounts/import', {
        method: 'POST',
        headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ label: 'x'.repeat(101) })).status).toBe(400)
    expect((await post({ label: 'Work', extra: 1 })).status).toBe(400)
    const res = await post({ label: '  Work ' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 'c', label: 'Work' })
  })

  it('GET /accounts/current reports the live login, never tokens', async () => {
    expect(await (await req('/api/accounts/current')).json()).toEqual({ login: null })
    session.live = { oauth: fakeTokens('a', 0), account: fakeAccount('a').oauthAccount }
    const body = await (await req('/api/accounts/current')).json()
    expect(body).toEqual({
      login: { id: 'a', email: fakeAccount('a').oauthAccount.emailAddress, known: true },
    })
    expect(JSON.stringify(body)).not.toMatch(/fake-|token/i)
  })

  it('POST /accounts/import → 409 when Claude Code is not logged in', async () => {
    const res = await req('/api/accounts/import', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not-logged-in' })
  })

  it('POST /accounts/import → 409 when a Claude Code file is unusable (no content leaked)', async () => {
    session.readCurrentLogin = () =>
      Promise.reject(new ClaudeCodeFileError('/tmp/x/.credentials.json', 'invalid JSON'))
    const res = await req('/api/accounts/import', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'claude-code-file' })
  })

  it('malformed JSON body → 400', async () => {
    const res = await req('/api/accounts/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-request' })
  })

  it('PATCH /accounts/:id renames and toggles', async () => {
    const res = await req('/api/accounts/a', json('PATCH', { label: '  Work  ', enabled: false }))
    expect(res.status).toBe(200)
    expect(config.data.accounts[0]).toMatchObject({ label: 'Work', enabled: false })
    expect(engine.runs).toEqual([{ manual: true }])
  })

  it('PATCH /accounts/:id validates the body', async () => {
    for (const body of [{}, { label: '' }, { enabled: 'yes' }, { label: 'x', extra: 1 }]) {
      const res = await req('/api/accounts/a', json('PATCH', body))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('validation')
    }
  })

  it('PATCH /accounts/:id → 404 for an unknown account', async () => {
    const res = await req('/api/accounts/zzz', json('PATCH', { enabled: true }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'account-not-found' })
  })

  it('DELETE /accounts/:id', async () => {
    expect((await req('/api/accounts/a', { method: 'DELETE' })).status).toBe(200)
    expect(config.data.accounts.map((a) => a.id)).toEqual(['b'])
    expect((await req('/api/accounts/a', { method: 'DELETE' })).status).toBe(404)
  })

  it('PUT /accounts/order', async () => {
    expect((await req('/api/accounts/order', json('PUT', { ids: ['b', 'a'] }))).status).toBe(200)
    expect(config.data.accounts.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('PUT /accounts/order validates shape and completeness', async () => {
    expect((await req('/api/accounts/order', json('PUT', { ids: 'a' }))).status).toBe(400)
    const res = await req('/api/accounts/order', json('PUT', { ids: ['a'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid-order' })
  })

  it('POST /accounts/:id/promote', async () => {
    expect((await req('/api/accounts/b/promote', { method: 'POST' })).status).toBe(200)
    expect(config.data.accounts.map((a) => a.id)).toEqual(['b', 'a'])
    expect((await req('/api/accounts/x/promote', { method: 'POST' })).status).toBe(404)
  })

  it('GET /preferences', async () => {
    expect(await (await req('/api/preferences')).json()).toEqual(DEFAULT_PREFERENCES)
  })

  it('PATCH /preferences merges and returns the result', async () => {
    const res = await req('/api/preferences', json('PATCH', { theme: 'dark', locale: 'pt-BR' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark', locale: 'pt-BR' })
    expect(config.data.preferences.theme).toBe('dark')
  })

  it('PATCH /preferences validates', async () => {
    for (const body of [
      { theme: 'blue' },
      { locale: 'fr' },
      { thresholds: { fiveHour: 101, sevenDay: 98 } },
      { thresholds: { fiveHour: 90 } },
      { pollIntervalSec: 5 },
      { nope: true },
    ]) {
      expect((await req('/api/preferences', json('PATCH', body))).status).toBe(400)
    }
  })

  it('POST /engine/run answers once the forced tick is done', async () => {
    let finishTick = () => {}
    engine.gate = new Promise<void>((resolve) => {
      finishTick = resolve
    })
    let answered = false
    const pending = Promise.resolve(req('/api/engine/run', { method: 'POST' })).then((res) => {
      answered = true
      return res
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(answered).toBe(false)
    finishTick()
    const res = await pending
    expect(res.status).toBe(200)
    expect(engine.runs).toEqual([{}])
  })

  it('unknown /api route → JSON 404', async () => {
    const res = await req('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not-found' })
  })

  it('unexpected errors → 500 without details, logged redacted', async () => {
    config.load = () => Promise.reject(new Error('disk on fire sk-ant-oat01-secret'))
    const res = await req('/api/dashboard')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'internal' })
    expect(text).not.toContain('fire')
    expect(logger.lines[0]).toMatchObject({ level: 'error', message: 'request failed' })
  })
})

describe('static + SPA fallback', () => {
  it('serves index.html with lang and dark class from preferences', async () => {
    config.data = {
      ...config.data,
      preferences: { ...DEFAULT_PREFERENCES, theme: 'dark', locale: 'pt-BR' },
    }
    for (const path of ['/', '/index.html', '/accounts/new', '/settings']) {
      const res = await req(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(await res.text()).toContain('<html lang="pt-BR" class="dark">')
    }
  })

  it('marks an explicit light theme and leaves system to the client', async () => {
    const cases = [
      ['light', '<html lang="es" class="light">'],
      ['system', '<html lang="es">'],
    ] as const
    for (const [theme, tag] of cases) {
      config.data = { ...config.data, preferences: { ...DEFAULT_PREFERENCES, theme, locale: 'es' } }
      expect(await (await req('/')).text()).toContain(tag)
    }
  })

  it('serves hashed assets with a long immutable cache', async () => {
    const res = await req('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('serves other files without the long cache', async () => {
    const res = await req('/favicon.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('404s a missing asset instead of returning the SPA', async () => {
    expect((await req('/assets/missing.js')).status).toBe(404)
  })

  it('503s when the SPA is not built', async () => {
    app = createApp({ ...c, webRoot: join(webRoot, 'nope') })
    expect((await req('/')).status).toBe(503)
  })
})

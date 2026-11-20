import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '@/domain/preferences'
import type { UsageSnapshot } from '@/domain/usage'
import {
  InvalidGrantError,
  NetworkError,
  RateLimitedError,
  UnauthorizedError,
} from './anthropic-errors'
import { DEBOUNCE_MS, Engine } from './engine'
import type { StoredAccount } from './ports'
import {
  FakeClaudeCodeSession,
  FakeClock,
  FakeTokenRefresher,
  FakeUsageApi,
  fakeAccount,
  fakeTokens,
  MemoryConfigRepository,
  MemoryLogger,
  MemorySecretsRepository,
  MemoryStateRepository,
  SimpleMutex,
} from './testing/fakes'
import { promoteAccount, type UseCaseDeps } from './use-cases'

const MIN = 60_000
const HOUR = 60 * MIN

function setup(accountIds = ['a', 'b', 'c'], prefs: Partial<Preferences> = {}) {
  const clock = new FakeClock()
  const later = clock.now().getTime() + 8 * HOUR
  const accounts: StoredAccount[] = accountIds.map((id) => fakeAccount(id))
  const config = new MemoryConfigRepository({
    preferences: { ...DEFAULT_PREFERENCES, ...prefs },
    accounts,
  })
  const secrets = new MemorySecretsRepository()
  for (const id of accountIds) secrets.tokens.set(id, fakeTokens(id, later))
  const state = new MemoryStateRepository()
  const first = accounts[0] as StoredAccount
  const session = new FakeClaudeCodeSession({
    oauth: fakeTokens(first.id, later),
    account: first.oauthAccount,
  })
  const usageApi = new FakeUsageApi()
  const refresher = new FakeTokenRefresher(clock)
  const logger = new MemoryLogger()
  const mutex = new SimpleMutex()
  const deps = { config, secrets, state, session, usageApi, refresher, clock, logger, mutex }
  const engine = new Engine(deps)

  /** Usage answered for the account's current access token. */
  const usage = (id: string, fiveHour: number, resetsInMs = 2 * HOUR, sevenDay = 10) => {
    const snap: UsageSnapshot = {
      fiveHour: { utilization: fiveHour, resetsAt: new Date(clock.now().getTime() + resetsInMs) },
      sevenDay: {
        utilization: sevenDay,
        resetsAt: new Date(clock.now().getTime() + 3 * 24 * HOUR),
      },
      fetchedAt: clock.now(),
    }
    usageApi.byToken.set(`fake-access-${id}`, snap)
    return snap
  }
  for (const id of accountIds) usage(id, 10)
  const live = () => session.live?.account.accountUuid
  const swaps = () => state.data.activity.filter((e) => e.type === 'swap')
  return { ...deps, engine, usage, live, swaps, later }
}

describe('Engine tick', () => {
  it('A exhausted → swaps to B, writing B tokens + identity and a swap entry', async () => {
    const s = setup()
    s.usage('a', 100)
    await s.engine.tick()
    expect(s.live()).toBe('b')
    expect(s.session.live?.oauth.accessToken).toBe('fake-access-b')
    expect(s.session.live?.account).toEqual(fakeAccount('b').oauthAccount)
    expect(s.swaps()).toEqual([
      { t: s.clock.now(), type: 'swap', from: 'a', to: 'b', reason: 'auto-exhausted' },
    ])
    expect(s.state.data.lastActiveId).toBe('b')
  })

  it('A resets → swaps back up to A', async () => {
    const s = setup()
    s.usage('a', 100, HOUR)
    await s.engine.tick()
    expect(s.live()).toBe('b')
    s.clock.advance(HOUR + MIN) // A's window reset; its last snapshot no longer blocks
    s.usageApi.byToken.set('fake-access-a', new NetworkError('ECONNRESET'))
    await s.engine.tick()
    expect(s.live()).toBe('a')
    expect(s.swaps().at(-1)).toMatchObject({ from: 'b', to: 'a', reason: 'auto-reset' })
  })

  it('stays put when the top account is fine (no write, no swap)', async () => {
    const s = setup()
    await s.engine.tick()
    expect(s.session.writes).toEqual([])
    expect(s.swaps()).toEqual([])
    expect(s.state.data.lastActiveId).toBe('a')
  })

  it('autoRotate off: keeps the top account even when exhausted, swaps to it as manual', async () => {
    const s = setup(['a', 'b'], { autoRotate: false })
    s.usage('a', 100)
    await s.engine.tick()
    expect(s.session.writes).toEqual([])
    s.session.live = { oauth: fakeTokens('b', s.later), account: fakeAccount('b').oauthAccount }
    await s.engine.tick()
    expect(s.live()).toBe('a')
    expect(s.swaps()).toMatchObject([{ from: 'b', to: 'a', reason: 'manual' }])
  })

  it('all exhausted → keeps the current account', async () => {
    const s = setup()
    for (const id of ['a', 'b', 'c']) s.usage(id, 100)
    await s.engine.tick()
    expect(s.session.writes).toEqual([])
  })

  it('all exhausted and current disabled → the account that recovers first', async () => {
    const s = setup()
    s.config.data = {
      ...s.config.data,
      accounts: s.config.data.accounts.map((a) => (a.id === 'a' ? { ...a, enabled: false } : a)),
    }
    s.usage('b', 100, 3 * HOUR)
    s.usage('c', 100, HOUR)
    await s.engine.tick()
    expect(s.swaps()).toMatchObject([{ from: 'a', to: 'c', reason: 'all-exhausted' }])
  })

  it('syncs back tokens Claude Code rotated for the active account, before swapping away', async () => {
    const s = setup()
    s.usage('a', 100)
    const rotated = { ...fakeTokens('a2', s.later), accessToken: 'fake-access-a' }
    s.session.live = { oauth: rotated, account: fakeAccount('a').oauthAccount }
    await s.engine.tick()
    expect(s.live()).toBe('b')
    expect(await s.secrets.get('a')).toEqual(rotated)
  })

  it('re-syncs right before the swap when Claude Code rotates the token mid-tick', async () => {
    const s = setup()
    const late = { ...fakeTokens('a3', s.later), accessToken: 'fake-access-a3' }
    const exhausted = s.usage('a', 100)
    s.usageApi.byToken.set('fake-access-a', () => {
      s.session.live = { oauth: late, account: fakeAccount('a').oauthAccount }
      return exhausted
    })
    await s.engine.tick()
    expect(s.live()).toBe('b')
    expect(await s.secrets.get('a')).toEqual(late)
  })

  it('refreshes inactive tokens close to expiry, never the active one', async () => {
    const s = setup()
    const soon = s.clock.now().getTime() + 5 * MIN
    s.secrets.tokens.set('a', fakeTokens('a', soon))
    s.session.live = { oauth: fakeTokens('a', soon), account: fakeAccount('a').oauthAccount }
    s.secrets.tokens.set('b', fakeTokens('b', soon))
    s.usageApi.byToken.set('fake-access-b+r', s.usageApi.byToken.get('fake-access-b') as never)
    await s.engine.tick()
    expect(s.refresher.calls.map((c) => c.accessToken)).toEqual(['fake-access-b'])
    expect(await s.secrets.get('b')).toMatchObject({
      accessToken: 'fake-access-b+r',
      refreshToken: 'fake-refresh-b+r',
      subscriptionType: 'max',
    })
    expect(s.usageApi.calls).toContain('fake-access-b+r')
  })

  it('invalid_grant → needsReauth (persisted + activity); the account is then skipped', async () => {
    const s = setup()
    s.secrets.tokens.set('b', fakeTokens('b', s.clock.now().getTime() - MIN))
    s.refresher.next = () => new InvalidGrantError()
    s.usage('a', 100)
    await s.engine.tick()
    expect(s.config.data.accounts.find((a) => a.id === 'b')?.needsReauth).toBe(true)
    expect(s.state.data.activity).toContainEqual({
      t: s.clock.now(),
      type: 'needs-reauth',
      accountId: 'b',
    })
    expect(s.usageApi.calls).not.toContain('fake-access-b')
    expect(s.live()).toBe('c')
    s.refresher.calls.length = 0
    await s.engine.tick()
    expect(s.refresher.calls).toEqual([])
  })

  it('a fresh /login of a needsReauth account clears the flag', async () => {
    const s = setup()
    s.config.data = {
      ...s.config.data,
      accounts: s.config.data.accounts.map((a) => (a.id === 'a' ? { ...a, needsReauth: true } : a)),
    }
    s.session.live = { oauth: fakeTokens('a-new', s.later), account: fakeAccount('a').oauthAccount }
    await s.engine.tick()
    expect(s.config.data.accounts[0]?.needsReauth).toBe(false)
  })

  it('other refresh errors are logged and retried next tick', async () => {
    const s = setup()
    s.secrets.tokens.set('b', fakeTokens('b', s.clock.now().getTime() + MIN))
    s.refresher.next = () => new NetworkError('ETIMEDOUT')
    await s.engine.tick()
    expect(s.config.data.accounts[1]?.needsReauth).toBe(false)
    expect(s.logger.lines.some((l) => l.message === 'token refresh failed')).toBe(true)
    await s.engine.tick()
    expect(s.refresher.calls).toHaveLength(2)
  })

  it('rate limit → backs off that account only, keeping its last good snapshot', async () => {
    const s = setup()
    await s.engine.tick()
    const good = s.state.data.usage.b
    s.usageApi.byToken.set('fake-access-b', new RateLimitedError(600))
    await s.engine.tick()
    expect(s.state.data.usage.b).toEqual({ ...good, error: expect.stringMatching(/rate limited/) })
    s.usageApi.calls.length = 0
    s.clock.advance(5 * MIN)
    await s.engine.tick()
    expect(s.usageApi.calls).not.toContain('fake-access-b')
    expect(s.usageApi.calls).toContain('fake-access-a')
    s.clock.advance(6 * MIN)
    await s.engine.tick()
    expect(s.usageApi.calls).toContain('fake-access-b')
  })

  it('401 on an inactive account → refreshes it at once and polls again with the new token', async () => {
    const s = setup()
    const good = s.usageApi.byToken.get('fake-access-b')
    s.usageApi.byToken.set('fake-access-b', new UnauthorizedError())
    s.usageApi.byToken.set('fake-access-b+r', good as never)
    await s.engine.tick()
    expect(s.refresher.calls.map((c) => c.accessToken)).toEqual(['fake-access-b'])
    expect((await s.secrets.get('b'))?.accessToken).toBe('fake-access-b+r')
    expect(s.state.data.usage.b).toEqual(good)
  })

  it('401 on an inactive account whose refresh is refused → needsReauth', async () => {
    const s = setup()
    s.usageApi.byToken.set('fake-access-b', new UnauthorizedError())
    s.refresher.next = () => new InvalidGrantError()
    await s.engine.tick()
    expect(s.config.data.accounts[1]?.needsReauth).toBe(true)
    expect(s.state.data.usage.b?.error).toMatch(/401/)
  })

  it('401 on the live account → never refreshed (Claude Code owns it), error snapshot', async () => {
    const s = setup()
    s.usageApi.byToken.set('fake-access-a', new UnauthorizedError())
    await s.engine.tick()
    expect(s.refresher.calls).toEqual([])
    expect(s.state.data.usage.a?.error).toMatch(/401/)
  })

  it('rate limit without Retry-After uses the default backoff', async () => {
    const s = setup(['a'])
    s.usageApi.byToken.set('fake-access-a', new RateLimitedError(null))
    await s.engine.tick()
    s.clock.advance(9 * MIN)
    await s.engine.tick()
    expect(s.usageApi.calls).toHaveLength(1)
  })

  it('records an error snapshot when an account was never polled successfully', async () => {
    const s = setup(['a'])
    s.usageApi.byToken.set('fake-access-a', new NetworkError('ENOTFOUND'))
    await s.engine.tick()
    expect(s.state.data.usage.a).toEqual({
      fiveHour: null,
      sevenDay: null,
      fetchedAt: s.clock.now(),
      error: 'Anthropic API unreachable: ENOTFOUND',
    })
    expect(s.state.data.history).toEqual([])
  })

  it('appends one history point per successful poll and skips disabled accounts', async () => {
    const s = setup()
    s.config.data = {
      ...s.config.data,
      accounts: s.config.data.accounts.map((a) => (a.id === 'c' ? { ...a, enabled: false } : a)),
    }
    s.usage('a', 42, HOUR, 7)
    await s.engine.tick()
    expect(s.state.data.history).toEqual([
      { t: s.clock.now(), accountId: 'a', fiveHour: 42, sevenDay: 7 },
      { t: s.clock.now(), accountId: 'b', fiveHour: 10, sevenDay: 10 },
    ])
  })

  it('polls at most two accounts at a time', async () => {
    const s = setup(['a', 'b', 'c', 'd'])
    let inFlight = 0
    let max = 0
    const orig = s.usageApi.fetchUsage.bind(s.usageApi)
    s.usageApi.fetchUsage = async (token) => {
      max = Math.max(max, ++inFlight)
      await new Promise((r) => setImmediate(r))
      inFlight--
      return orig(token)
    }
    await s.engine.tick()
    expect(max).toBe(2)
    expect(s.state.data.history).toHaveLength(4)
  })

  it('unknown live login → status flag, never overwritten', async () => {
    const s = setup()
    s.usage('a', 100)
    const stranger = { accountUuid: 'zz', emailAddress: 'zz@example.test' }
    s.session.live = { oauth: fakeTokens('zz', s.later), account: stranger }
    await s.engine.tick()
    expect(s.engine.status().unknownLogin).toBe('zz@example.test')
    expect(s.session.writes).toEqual([])
    s.session.live = { oauth: fakeTokens('a', s.later), account: fakeAccount('a').oauthAccount }
    await s.engine.tick()
    expect(s.engine.status().unknownLogin).toBeNull()
  })

  it('a removed account we had made active is replaced, its tokens not re-stored', async () => {
    const s = setup()
    await s.engine.tick() // lastActiveId = a
    s.config.data = { ...s.config.data, accounts: s.config.data.accounts.slice(1) }
    s.secrets.tokens.delete('a')
    await s.engine.tick()
    expect(s.engine.status().unknownLogin).toBeNull()
    expect(s.live()).toBe('b')
    expect(s.swaps()).toMatchObject([{ from: 'a', to: 'b' }])
    expect(await s.secrets.get('a')).toBeNull()
  })

  it('no live login → swaps to the top account', async () => {
    const s = setup()
    s.session.live = null
    await s.engine.tick()
    expect(s.swaps()).toMatchObject([{ from: null, to: 'a', reason: 'top-priority' }])
  })

  it('a torn swap (B credentials under A identity) is rewritten, not synced back', async () => {
    const s = setup()
    s.usage('a', 100)
    s.session.failAfterCredentials = true
    await s.engine.tick()
    expect(s.state.data.activity.at(-1)).toMatchObject({ type: 'error', message: 'disk full' })
    expect(s.session.live?.account.accountUuid).toBe('a') // identity not yet written
    await s.engine.tick()
    expect(await s.secrets.get('a')).toEqual(fakeTokens('a', s.later)) // not overwritten by B
    expect(s.session.live).toEqual({
      oauth: fakeTokens('b', s.later),
      account: fakeAccount('b').oauthAccount,
    })
    expect(s.swaps()).toMatchObject([{ from: null, to: 'b' }])
  })

  it('never throws: a failing Claude Code read becomes an error entry + log', async () => {
    const s = setup()
    s.session.readCurrentLogin = () => Promise.reject(new Error('bad file'))
    await expect(s.engine.tick()).resolves.toBeUndefined()
    expect(s.state.data.activity).toMatchObject([{ type: 'error', message: 'bad file' }])
    expect(s.logger.lines).toContainEqual({
      level: 'error',
      message: 'engine tick failed',
      fields: { error: 'bad file' },
    })
  })

  it('never throws even when loading or saving fails', async () => {
    const s = setup()
    s.config.load = () => Promise.reject(new Error('io'))
    await expect(s.engine.tick()).resolves.toBeUndefined()
    const t = setup()
    t.state.save = () => Promise.reject(new Error('io'))
    await expect(t.engine.tick()).resolves.toBeUndefined()
    expect(t.logger.lines.at(-1)?.message).toBe('engine could not save state')
  })

  it('a missing token for the chosen account is an error entry, not a crash', async () => {
    const s = setup()
    s.usage('a', 100)
    s.secrets.tokens.delete('b')
    await s.engine.tick()
    expect(s.state.data.activity.at(-1)).toMatchObject({ type: 'error' })
    expect(s.live()).toBe('a')
  })
})

describe('Engine scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start ticks soon, then every pollIntervalSec; stop cancels', async () => {
    const s = setup(['a'], { pollIntervalSec: 60 })
    s.engine.start()
    s.engine.start() // idempotent
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(s.usageApi.calls).toHaveLength(1)
    expect(s.engine.status()).toMatchObject({ running: true, lastTickAt: s.clock.now() })
    expect(s.engine.status().nextTickAt).toEqual(new Date(s.clock.now().getTime() + 60_000))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.usageApi.calls).toHaveLength(2)
    await s.engine.stop()
    expect(s.engine.status()).toMatchObject({ running: false, nextTickAt: null })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(s.usageApi.calls).toHaveLength(2)
  })

  it('re-schedules with the new interval after preferences change', async () => {
    const s = setup(['a'], { pollIntervalSec: 60 })
    s.engine.start()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    s.config.data = {
      ...s.config.data,
      preferences: { ...s.config.data.preferences, pollIntervalSec: 600 },
    }
    const run = s.engine.runNow()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await run
    expect(s.usageApi.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(599_000)
    expect(s.usageApi.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(s.usageApi.calls).toHaveLength(3)
    s.engine.stop()
  })

  it('caps a hand-edited huge pollIntervalSec at a day (setTimeout would overflow to 1 ms)', async () => {
    const s = setup(['a'], { pollIntervalSec: 3_000_000 })
    s.engine.start()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.usageApi.calls).toHaveLength(1)
    expect(s.engine.status().nextTickAt).toEqual(new Date(s.clock.now().getTime() + 86_400_000))
    await s.engine.stop()
  })

  it('stop waits for the running tick and settles a pending runNow; start works again', async () => {
    const s = setup(['a'])
    let release = () => {}
    s.usageApi.byToken.set(
      'fake-access-a',
      () => new Promise((r) => (release = () => r(s.usage('a', 10)))) as never,
    )
    s.engine.start()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS) // tick in flight, blocked on the poll
    let stopped = false
    const stop = s.engine.stop().then(() => (stopped = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toBe(false)
    release()
    await stop
    expect(s.state.data.usage.a).toBeDefined() // the tick finished and saved before stop resolved

    const pending = s.engine.runNow()
    await s.engine.stop()
    await pending // settled by stop, not left hanging
    s.usage('a', 10)
    s.engine.start()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(s.usageApi.calls).toHaveLength(2)
    await s.engine.stop()
  })

  it('runNow coalesces a burst into one tick', async () => {
    const s = setup(['a'])
    const p = Promise.all([s.engine.runNow(), s.engine.runNow(), s.engine.runNow()])
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await p
    expect(s.usageApi.calls).toHaveLength(1)
    expect(s.engine.status().nextTickAt).toBeNull() // not started: no schedule
  })

  it('manual promote → swap labelled manual', async () => {
    const s = setup()
    const deps: UseCaseDeps = { ...s, engine: s.engine }
    await promoteAccount(deps, 'c')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(s.live()).toBe('c')
    expect(s.swaps()).toMatchObject([{ from: 'a', to: 'c', reason: 'manual' }])
    // the manual flag is consumed: a later automatic swap is labelled by the policy
    s.usage('c', 100)
    await s.engine.tick()
    expect(s.swaps().at(-1)).toMatchObject({ from: 'c', to: 'a', reason: 'auto-exhausted' })
  })
})

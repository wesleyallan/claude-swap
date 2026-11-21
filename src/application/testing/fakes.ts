// In-memory fakes for every application port. Used by application and server tests.
import type { AccountId } from '@/domain/account'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import type { UsageSnapshot } from '@/domain/usage'
import type { EngineControl, EngineStatus, RunOptions } from '../engine'
import type {
  AppConfig,
  AppState,
  ClaudeCodeLogin,
  ClaudeCodeSession,
  Clock,
  ConfigRepository,
  LogFields,
  Logger,
  Mutex,
  OAuthAccount,
  OAuthTokens,
  SecretsRepository,
  StateRepository,
  StoredAccount,
  TokenRefresher,
  UsageApi,
} from '../ports'

export class FakeClock implements Clock {
  constructor(public current: Date = new Date('2026-11-19T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export class MemoryLogger implements Logger {
  readonly lines: { level: string; message: string; fields?: LogFields }[] = []
  info(message: string, fields?: LogFields) {
    this.lines.push({ level: 'info', message, ...(fields && { fields }) })
  }
  warn(message: string, fields?: LogFields) {
    this.lines.push({ level: 'warn', message, ...(fields && { fields }) })
  }
  error(message: string, fields?: LogFields) {
    this.lines.push({ level: 'error', message, ...(fields && { fields }) })
  }
}

export class SimpleMutex implements Mutex {
  #tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(fn)
    this.#tail = result.catch(() => undefined)
    return result
  }
}

export class MemoryConfigRepository implements ConfigRepository {
  constructor(public data: AppConfig = { preferences: DEFAULT_PREFERENCES, accounts: [] }) {}
  async load() {
    return this.data
  }
  async save(config: AppConfig) {
    this.data = config
  }
}

export class MemorySecretsRepository implements SecretsRepository {
  readonly tokens = new Map<AccountId, OAuthTokens>()
  async get(id: AccountId) {
    return this.tokens.get(id) ?? null
  }
  async set(id: AccountId, tokens: OAuthTokens) {
    this.tokens.set(id, tokens)
  }
  async delete(id: AccountId) {
    this.tokens.delete(id)
  }
}

const emptyState = (): AppState => ({
  usage: {},
  history: [],
  activity: [],
  lastActiveId: null,
})

export class MemoryStateRepository implements StateRepository {
  saves = 0
  constructor(public data: AppState = emptyState()) {}
  async load() {
    return this.data
  }
  async save(state: AppState) {
    this.saves++
    this.data = state
  }
}

export class FakeClaudeCodeSession implements ClaudeCodeSession {
  writes: ClaudeCodeLogin[] = []
  /** Set to make the next `writeLogin` write only `.credentials.json` and then throw. */
  failAfterCredentials = false
  constructor(public live: ClaudeCodeLogin | null = null) {}
  async readCurrentLogin() {
    return this.live
  }
  async writeLogin(oauth: OAuthTokens, account: OAuthAccount) {
    if (this.failAfterCredentials) {
      this.failAfterCredentials = false
      this.live = { oauth, account: this.live?.account ?? account }
      throw new Error('disk full')
    }
    this.live = { oauth, account }
    this.writes.push(this.live)
  }
}

type UsageResult = UsageSnapshot | Error | ((token: string) => UsageSnapshot | Error)

/** Answers by access token; unknown tokens reject. */
export class FakeUsageApi implements UsageApi {
  readonly byToken = new Map<string, UsageResult>()
  readonly calls: string[] = []
  async fetchUsage(accessToken: string) {
    this.calls.push(accessToken)
    let r = this.byToken.get(accessToken) ?? new Error(`unknown token ${accessToken}`)
    if (typeof r === 'function') r = r(accessToken)
    if (r instanceof Error) throw r
    return r
  }
}

export class FakeTokenRefresher implements TokenRefresher {
  readonly calls: OAuthTokens[] = []
  /** Default: rotate both tokens and extend expiry by 8 h from `clock`. */
  next: (previous: OAuthTokens) => OAuthTokens | Error
  constructor(clock: Clock) {
    this.next = (p) => ({
      ...p,
      accessToken: `${p.accessToken}+r`,
      refreshToken: `${p.refreshToken}+r`,
      expiresAt: clock.now().getTime() + 8 * 3_600_000,
    })
  }
  async refresh(previous: OAuthTokens) {
    this.calls.push(previous)
    const r = this.next(previous)
    if (r instanceof Error) throw r
    return r
  }
}

export class FakeEngine implements EngineControl {
  readonly runs: RunOptions[] = []
  current: EngineStatus = {
    running: false,
    lastTickAt: null,
    nextTickAt: null,
    unknownLogin: null,
  }
  /** Set to hold `runNow` open, to check a caller waits for the tick. */
  gate: Promise<void> = Promise.resolve()
  runNow(options: RunOptions = {}) {
    this.runs.push(options)
    return this.gate
  }
  checks = 0
  checkNow() {
    this.checks++
    return this.gate
  }
  status() {
    return this.current
  }
  start() {
    this.current = { ...this.current, running: true }
  }
  async stop() {
    this.current = { ...this.current, running: false }
  }
}

/** Fake but well-formed account + identity + tokens. */
export function fakeAccount(id: AccountId, over: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id,
    label: id.toUpperCase(),
    email: `${id}@example.test`,
    organizationName: null,
    subscriptionType: 'max',
    enabled: true,
    needsReauth: false,
    addedAt: new Date('2026-11-01T00:00:00.000Z'),
    oauthAccount: {
      accountUuid: id,
      emailAddress: `${id}@example.test`,
      organizationUuid: `org-${id}`,
    },
    ...over,
  }
}

export const fakeTokens = (tag: string, expiresAt: number): OAuthTokens => ({
  accessToken: `fake-access-${tag}`,
  refreshToken: `fake-refresh-${tag}`,
  expiresAt,
  subscriptionType: 'max',
})

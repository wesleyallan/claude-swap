// Rotation engine. One tick: sync back → refresh inactive tokens → poll usage → decide → swap.
import type { AccountId } from '@/domain/account'
import { type SelectionReason, selectActiveAccount } from '@/domain/rotation-policy'
import type { UsageSnapshot } from '@/domain/usage'
import { InvalidGrantError, RateLimitedError, UnauthorizedError } from './anthropic-errors'
import type {
  ActivityEntry,
  AppConfig,
  AppState,
  ClaudeCodeSession,
  Clock,
  ConfigRepository,
  HistoryPoint,
  Logger,
  Mutex,
  OAuthTokens,
  SecretsRepository,
  StateRepository,
  StoredAccount,
  TokenRefresher,
  UsageApi,
} from './ports'

export const REFRESH_WINDOW_MS = 10 * 60_000
export const DEBOUNCE_MS = 250
/** Backoff after a 429 without a usable `Retry-After`. */
export const DEFAULT_BACKOFF_SEC = 600
export const POLL_CONCURRENCY = 2

export interface RunOptions {
  /** The run follows a user reorder/promote/enable: a resulting swap is labelled `manual`. */
  readonly manual?: boolean
}

export interface EngineStatus {
  /** Between `start()` and `stop()`. */
  readonly running: boolean
  readonly lastTickAt: Date | null
  readonly nextTickAt: Date | null
  /** Email of a live Claude Code login that is not one of ours (offer import), else null. */
  readonly unknownLogin: string | null
}

/** What use cases and the server need from the engine. */
export interface EngineControl {
  runNow(options?: RunOptions): Promise<void>
  status(): EngineStatus
}

export interface EngineDeps {
  readonly config: ConfigRepository
  readonly secrets: SecretsRepository
  readonly state: StateRepository
  readonly session: ClaudeCodeSession
  readonly usageApi: UsageApi
  readonly refresher: TokenRefresher
  readonly clock: Clock
  readonly logger: Logger
  readonly mutex: Mutex
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Mutable working copy of one tick; saved once at the end. */
interface Tick {
  config: AppConfig
  configDirty: boolean
  state: AppState
  /** Live login account id when it is one of ours (or the one we last wrote), else null. */
  liveId: AccountId | null
  manual: boolean
}

export class Engine implements EngineControl {
  readonly #d: EngineDeps
  #running = false
  #timer: ReturnType<typeof setTimeout> | undefined
  #debounce: Promise<void> | null = null
  #debounceTimer: ReturnType<typeof setTimeout> | undefined
  #manual = false
  #lastTickAt: Date | null = null
  #nextTickAt: Date | null = null
  #unknownLogin: string | null = null
  /** Per-account "do not poll before" after a 429. */
  readonly #backoff = new Map<AccountId, Date>()

  constructor(deps: EngineDeps) {
    this.#d = deps
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    void this.runNow()
  }

  stop(): void {
    this.#running = false
    clearTimeout(this.#timer)
    clearTimeout(this.#debounceTimer)
    this.#nextTickAt = null
  }

  /** Debounced: calls within `DEBOUNCE_MS` coalesce into one tick (manual if any asked for it). */
  runNow(options: RunOptions = {}): Promise<void> {
    if (options.manual) this.#manual = true
    this.#debounce ??= new Promise<void>((resolve) => {
      this.#debounceTimer = setTimeout(() => {
        this.#debounce = null
        void this.tick().then(resolve)
      }, DEBOUNCE_MS)
    })
    return this.#debounce
  }

  status(): EngineStatus {
    return {
      running: this.#running,
      lastTickAt: this.#lastTickAt,
      nextTickAt: this.#nextTickAt,
      unknownLogin: this.#unknownLogin,
    }
  }

  /** One full cycle under the mutex. Never rejects; then schedules the next tick if running. */
  async tick(): Promise<void> {
    clearTimeout(this.#timer)
    const interval = await this.#d.mutex.run(() => this.#safeTick())
    this.#lastTickAt = this.#d.clock.now()
    if (this.#running) {
      this.#nextTickAt = new Date(this.#lastTickAt.getTime() + interval * 1000)
      this.#timer = setTimeout(() => void this.tick(), interval * 1000)
    }
  }

  /** Returns the poll interval (seconds) to wait before the next tick. */
  async #safeTick(): Promise<number> {
    const { logger, clock } = this.#d
    const manual = this.#manual
    this.#manual = false
    let t: Tick | undefined
    try {
      t = {
        config: await this.#d.config.load(),
        configDirty: false,
        state: await this.#d.state.load(),
        liveId: null,
        manual,
      }
      await this.#syncBack(t)
      await this.#refreshInactive(t)
      await this.#pollUsage(t)
      await this.#decide(t)
    } catch (err) {
      logger.error('engine tick failed', { error: message(err) })
      if (t) record(t, { t: clock.now(), type: 'error', message: message(err) })
    }
    if (t) await this.#persist(t)
    return t?.config.preferences.pollIntervalSec ?? 180
  }

  async #persist(t: Tick): Promise<void> {
    try {
      if (t.configDirty) await this.#d.config.save(t.config)
      await this.#d.state.save(t.state)
    } catch (err) {
      this.#d.logger.error('engine could not save state', { error: message(err) })
    }
  }

  /**
   * Step 1: store the live login's tokens (Claude Code may have rotated them) under its account.
   * Also flags an unknown login and detects a torn swap (credentials of one account under the
   * identity of another), which is then rewritten in full instead of synced back.
   */
  async #syncBack(t: Tick): Promise<void> {
    this.#unknownLogin = null
    const live = await this.#d.session.readCurrentLogin()
    if (!live) return
    const id = live.account.accountUuid
    const ours = t.config.accounts.find((a) => a.id === id)
    if (!ours) {
      // We wrote it and it was removed since: ours to replace. Anything else: the user's /login.
      if (id === t.state.lastActiveId) t.liveId = id
      else this.#unknownLogin = live.account.emailAddress
      return
    }
    if (await this.#isTorn(id, live.oauth.refreshToken, t.config.accounts)) {
      this.#d.logger.warn('live login is a half-written swap; rewriting it', { accountId: id })
      return
    }
    t.liveId = id
    const stored = await this.#d.secrets.get(id)
    if (stored?.refreshToken !== live.oauth.refreshToken && ours.needsReauth) {
      setAccount(t, id, { needsReauth: false }) // fresh /login with this account
    }
    await this.#d.secrets.set(id, live.oauth)
    if (t.state.lastActiveId !== id) t.state = { ...t.state, lastActiveId: id }
  }

  /** The live refresh token belongs to another of our accounts. */
  async #isTorn(id: AccountId, refreshToken: string, accounts: readonly StoredAccount[]) {
    for (const a of accounts) {
      if (a.id !== id && (await this.#d.secrets.get(a.id))?.refreshToken === refreshToken) {
        return true
      }
    }
    return false
  }

  /** Step 2: inactive accounts' tokens are ours to refresh (token ownership rule). */
  async #refreshInactive(t: Tick): Promise<void> {
    const deadline = this.#d.clock.now().getTime() + REFRESH_WINDOW_MS
    for (const a of t.config.accounts) {
      if (a.id === t.liveId || a.needsReauth) continue
      const tokens = await this.#d.secrets.get(a.id)
      if (!tokens || tokens.expiresAt > deadline) continue
      await this.#refresh(t, a.id, tokens)
    }
  }

  /** Refreshes and persists one inactive account's tokens; `null` when the refresh failed. */
  async #refresh(t: Tick, id: AccountId, tokens: OAuthTokens): Promise<OAuthTokens | null> {
    try {
      const next = await this.#d.refresher.refresh(tokens)
      await this.#d.secrets.set(id, next)
      return next
    } catch (err) {
      if (err instanceof InvalidGrantError) {
        setAccount(t, id, { needsReauth: true })
        record(t, { t: this.#d.clock.now(), type: 'needs-reauth', accountId: id })
      }
      this.#d.logger.warn('token refresh failed', { accountId: id, error: message(err) })
      return null
    }
  }

  /** Step 3: poll enabled accounts, `POLL_CONCURRENCY` at a time; keep the last good snapshot. */
  async #pollUsage(t: Tick): Promise<void> {
    const { clock, secrets, usageApi, logger } = this.#d
    const now = clock.now()
    const queue = t.config.accounts.filter(
      (a) =>
        a.enabled && !a.needsReauth && !((this.#backoff.get(a.id)?.getTime() ?? 0) > now.getTime()),
    )
    const results: [AccountId, UsageSnapshot][] = []
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const tokens = await secrets.get(a.id)
        if (!tokens) continue
        const poll = async () => {
          try {
            return await usageApi.fetchUsage(tokens.accessToken)
          } catch (err) {
            // Revoked before expiresAt: an inactive account's tokens are ours, refresh and retry once.
            if (!(err instanceof UnauthorizedError) || a.id === t.liveId) throw err
            const fresh = await this.#refresh(t, a.id, tokens)
            if (!fresh) throw err
            return usageApi.fetchUsage(fresh.accessToken)
          }
        }
        try {
          results.push([a.id, await poll()])
          this.#backoff.delete(a.id)
        } catch (err) {
          if (err instanceof RateLimitedError) {
            const sec = err.retryAfter ?? DEFAULT_BACKOFF_SEC
            this.#backoff.set(a.id, new Date(now.getTime() + sec * 1000))
          }
          logger.warn('usage poll failed', { accountId: a.id, error: message(err) })
          const last = t.state.usage[a.id]
          const failed = last ?? { fiveHour: null, sevenDay: null, fetchedAt: now }
          results.push([a.id, { ...failed, error: message(err) }])
        }
      }
    }
    await Promise.all(Array.from({ length: POLL_CONCURRENCY }, worker))

    const points: HistoryPoint[] = results
      .filter(([, s]) => s.error === undefined)
      .map(([accountId, s]) => ({
        t: now,
        accountId,
        fiveHour: s.fiveHour?.utilization ?? null,
        sevenDay: s.sevenDay?.utilization ?? null,
      }))
    t.state = {
      ...t.state,
      usage: { ...t.state.usage, ...Object.fromEntries(results) },
      history: [...t.state.history, ...points],
    }
  }

  /** Step 4: pick the account that should be active and swap to it if it is not live. */
  async #decide(t: Tick): Promise<void> {
    if (this.#unknownLogin) return // never overwrite a login the user has not imported yet
    const { preferences, accounts } = t.config
    const choice = selectActiveAccount({
      accounts,
      usage: t.state.usage,
      thresholds: preferences.thresholds,
      now: this.#d.clock.now(),
      autoRotate: preferences.autoRotate,
      currentId: t.liveId,
    })
    if (!choice || choice.id === t.liveId) return
    await this.#swap(t, choice.id, t.manual ? 'manual' : choice.reason)
  }

  /** Swap procedure steps 1–4 (architecture §3). A failure is retried by the next tick. */
  async #swap(t: Tick, to: AccountId, reason: SelectionReason): Promise<void> {
    const { session, secrets, clock, logger } = this.#d
    // Re-sync right before writing: Claude Code may have rotated the live token since step 1.
    const live = await session.readCurrentLogin()
    const ours = (id: AccountId) => t.config.accounts.find((a) => a.id === id)
    if (live && t.liveId && live.account.accountUuid === t.liveId && ours(t.liveId)) {
      await secrets.set(t.liveId, live.oauth)
    }
    const target = ours(to) as StoredAccount
    const tokens = await secrets.get(to)
    if (!tokens) throw new Error(`no tokens stored for account ${to}`)
    await session.writeLogin(tokens, target.oauthAccount)
    record(t, { t: clock.now(), type: 'swap', from: t.liveId, to, reason })
    logger.info('swapped account', { from: t.liveId, to, reason })
    t.state = { ...t.state, lastActiveId: to }
    t.liveId = to
  }
}

function record(t: Tick, entry: ActivityEntry): void {
  t.state = { ...t.state, activity: [...t.state.activity, entry] }
}

function setAccount(t: Tick, id: AccountId, patch: Partial<StoredAccount>): void {
  t.config = {
    ...t.config,
    accounts: t.config.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }
  t.configDirty = true
}

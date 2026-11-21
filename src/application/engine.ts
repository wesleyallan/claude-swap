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

const REFRESH_AHEAD_MS = 10 * 60_000
export const DEBOUNCE_MS = 250
/** Used after a 429 without a usable `Retry-After`. */
const DEFAULT_RATE_LIMIT_BACKOFF_SEC = 600
const POLL_CONCURRENCY = 2
const FALLBACK_POLL_INTERVAL_SEC = 180
/** A day. The file schema has no upper bound and Node turns a delay above 2^31-1 ms into 1 ms. */
const MAX_POLL_INTERVAL_SEC = 86_400

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

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Mutable working copy of one tick; saved once at the end. */
interface TickContext {
  config: AppConfig
  configDirty: boolean
  state: AppState
  /** Live login account id when it is one of ours (or the one we last wrote), else null. */
  liveId: AccountId | null
  manual: boolean
}

export class Engine implements EngineControl {
  readonly #deps: EngineDeps
  #running = false
  #nextTickTimer: ReturnType<typeof setTimeout> | undefined
  #pendingRun: Promise<void> | null = null
  #pendingRunTimer: ReturnType<typeof setTimeout> | undefined
  #settlePendingRun: (() => void) | undefined
  #pendingRunIsManual = false
  #lastTickAt: Date | null = null
  #nextTickAt: Date | null = null
  #unknownLogin: string | null = null
  readonly #rateLimitedUntil = new Map<AccountId, Date>()

  constructor(deps: EngineDeps) {
    this.#deps = deps
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    void this.runNow()
  }

  /** Cancels scheduled and pending runs, then waits for a tick already in flight to finish. */
  async stop(): Promise<void> {
    this.#running = false
    clearTimeout(this.#nextTickTimer)
    clearTimeout(this.#pendingRunTimer)
    this.#settlePendingRun?.()
    this.#pendingRun = null
    this.#nextTickAt = null
    await this.#deps.mutex.run(async () => {})
  }

  /** Debounced: calls within `DEBOUNCE_MS` coalesce into one tick (manual if any asked for it). */
  runNow(options: RunOptions = {}): Promise<void> {
    if (options.manual) this.#pendingRunIsManual = true
    this.#pendingRun ??= new Promise<void>((resolve) => {
      this.#settlePendingRun = resolve
      this.#pendingRunTimer = setTimeout(() => {
        this.#pendingRun = null
        void this.tick().then(resolve)
      }, DEBOUNCE_MS)
    })
    return this.#pendingRun
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
    const intervalSec = await this.#deps.mutex.run(() => {
      // Cleared inside the mutex: a tick that ran while this one waited has scheduled a timer too.
      clearTimeout(this.#nextTickTimer)
      return this.#runTickSafely()
    })
    const delayMs = Math.min(intervalSec, MAX_POLL_INTERVAL_SEC) * 1000
    this.#lastTickAt = this.#deps.clock.now()
    if (this.#running) {
      this.#nextTickAt = new Date(this.#lastTickAt.getTime() + delayMs)
      this.#nextTickTimer = setTimeout(() => void this.tick(), delayMs)
    }
  }

  /** Sync back → refresh inactive tokens → poll usage → decide → swap. Returns the next delay (s). */
  async #runTickSafely(): Promise<number> {
    const { logger, clock } = this.#deps
    const manual = this.#pendingRunIsManual
    this.#pendingRunIsManual = false
    let tick: TickContext | undefined
    try {
      tick = {
        config: await this.#deps.config.load(),
        configDirty: false,
        state: await this.#deps.state.load(),
        liveId: null,
        manual,
      }
      await this.#syncBack(tick)
      await this.#refreshInactive(tick)
      await this.#pollUsage(tick)
      await this.#decide(tick)
    } catch (err) {
      logger.error('engine tick failed', { error: errorMessage(err) })
      if (tick) recordActivity(tick, { t: clock.now(), type: 'error', message: errorMessage(err) })
    }
    if (tick) await this.#persist(tick)
    return tick?.config.preferences.pollIntervalSec ?? FALLBACK_POLL_INTERVAL_SEC
  }

  async #persist(tick: TickContext): Promise<void> {
    try {
      if (tick.configDirty) await this.#deps.config.save(tick.config)
      await this.#deps.state.save(tick.state)
    } catch (err) {
      this.#deps.logger.error('engine could not save state', { error: errorMessage(err) })
    }
  }

  /**
   * Step 1: store the live login's tokens (Claude Code may have rotated them) under its account.
   * Also flags an unknown login and detects a torn swap (credentials of one account under the
   * identity of another), which is then rewritten in full instead of synced back.
   */
  async #syncBack(tick: TickContext): Promise<void> {
    this.#unknownLogin = null
    const live = await this.#deps.session.readCurrentLogin()
    if (!live) return
    const id = live.account.accountUuid
    const ours = tick.config.accounts.find((account) => account.id === id)
    if (!ours) {
      // We wrote it and it was removed since: ours to replace. Anything else: the user's /login.
      if (id === tick.state.lastActiveId) tick.liveId = id
      else this.#unknownLogin = live.account.emailAddress
      return
    }
    if (await this.#isTorn(id, live.oauth.refreshToken, tick.config.accounts)) {
      this.#deps.logger.warn('live login is a half-written swap; rewriting it', { accountId: id })
      return
    }
    tick.liveId = id
    const stored = await this.#deps.secrets.get(id)
    if (stored?.refreshToken !== live.oauth.refreshToken && ours.needsReauth) {
      patchAccount(tick, id, { needsReauth: false }) // fresh /login with this account
    }
    await this.#deps.secrets.set(id, live.oauth)
    if (tick.state.lastActiveId !== id) tick.state = { ...tick.state, lastActiveId: id }
  }

  /** The live refresh token belongs to another of our accounts. */
  async #isTorn(id: AccountId, refreshToken: string, accounts: readonly StoredAccount[]) {
    for (const other of accounts) {
      if (
        other.id !== id &&
        (await this.#deps.secrets.get(other.id))?.refreshToken === refreshToken
      ) {
        return true
      }
    }
    return false
  }

  /** Step 2: inactive accounts' tokens are ours to refresh (token ownership rule). */
  async #refreshInactive(tick: TickContext): Promise<void> {
    const deadline = this.#deps.clock.now().getTime() + REFRESH_AHEAD_MS
    for (const account of tick.config.accounts) {
      if (account.id === tick.liveId || account.needsReauth) continue
      const tokens = await this.#deps.secrets.get(account.id)
      if (!tokens || tokens.expiresAt > deadline) continue
      await this.#refresh(tick, account.id, tokens)
    }
  }

  /** Refreshes and persists one inactive account's tokens; `null` when the refresh failed. */
  async #refresh(
    tick: TickContext,
    id: AccountId,
    tokens: OAuthTokens,
  ): Promise<OAuthTokens | null> {
    try {
      const refreshed = await this.#deps.refresher.refresh(tokens)
      await this.#deps.secrets.set(id, refreshed)
      return refreshed
    } catch (err) {
      if (err instanceof InvalidGrantError) {
        patchAccount(tick, id, { needsReauth: true })
        recordActivity(tick, { t: this.#deps.clock.now(), type: 'needs-reauth', accountId: id })
      }
      this.#deps.logger.warn('token refresh failed', { accountId: id, error: errorMessage(err) })
      return null
    }
  }

  /** Step 3: poll enabled accounts, `POLL_CONCURRENCY` at a time; keep the last good snapshot. */
  async #pollUsage(tick: TickContext): Promise<void> {
    const { clock, secrets, usageApi, logger } = this.#deps
    const now = clock.now()
    const isRateLimited = (id: AccountId) =>
      (this.#rateLimitedUntil.get(id)?.getTime() ?? 0) > now.getTime()
    const queue = tick.config.accounts.filter(
      (account) => account.enabled && !account.needsReauth && !isRateLimited(account.id),
    )
    const results: [AccountId, UsageSnapshot][] = []
    const fetchUsage = async (account: StoredAccount, tokens: OAuthTokens) => {
      try {
        return await usageApi.fetchUsage(tokens.accessToken)
      } catch (err) {
        // Revoked before expiresAt: an inactive account's tokens are ours, refresh and retry once.
        if (!(err instanceof UnauthorizedError) || account.id === tick.liveId) throw err
        const fresh = await this.#refresh(tick, account.id, tokens)
        if (!fresh) throw err
        return usageApi.fetchUsage(fresh.accessToken)
      }
    }
    const worker = async () => {
      for (let account = queue.shift(); account; account = queue.shift()) {
        const tokens = await secrets.get(account.id)
        if (!tokens) continue
        try {
          results.push([account.id, await fetchUsage(account, tokens)])
          this.#rateLimitedUntil.delete(account.id)
        } catch (err) {
          if (err instanceof RateLimitedError) {
            const backoffSec = err.retryAfter ?? DEFAULT_RATE_LIMIT_BACKOFF_SEC
            this.#rateLimitedUntil.set(account.id, new Date(now.getTime() + backoffSec * 1000))
          }
          logger.warn('usage poll failed', { accountId: account.id, error: errorMessage(err) })
          const lastGood = tick.state.usage[account.id] ?? {
            fiveHour: null,
            sevenDay: null,
            fetchedAt: now,
          }
          results.push([account.id, { ...lastGood, error: errorMessage(err) }])
        }
      }
    }
    await Promise.all(Array.from({ length: POLL_CONCURRENCY }, worker))

    const points: HistoryPoint[] = results
      .filter(([, snapshot]) => snapshot.error === undefined)
      .map(([accountId, snapshot]) => ({
        t: now,
        accountId,
        fiveHour: snapshot.fiveHour?.utilization ?? null,
        sevenDay: snapshot.sevenDay?.utilization ?? null,
      }))
    tick.state = {
      ...tick.state,
      usage: { ...tick.state.usage, ...Object.fromEntries(results) },
      history: [...tick.state.history, ...points],
    }
  }

  /** Step 4: pick the account that should be active and swap to it if it is not live. */
  async #decide(tick: TickContext): Promise<void> {
    if (this.#unknownLogin) return // never overwrite a login the user has not imported yet
    const { preferences, accounts } = tick.config
    const choice = selectActiveAccount({
      accounts,
      usage: tick.state.usage,
      thresholds: preferences.thresholds,
      now: this.#deps.clock.now(),
      autoRotate: preferences.autoRotate,
      currentId: tick.liveId,
    })
    if (!choice || choice.id === tick.liveId) return
    await this.#swap(tick, choice.id, tick.manual ? 'manual' : choice.reason)
  }

  /** Swap procedure steps 1–4 (architecture §3). A failure is retried by the next tick. */
  async #swap(tick: TickContext, to: AccountId, reason: SelectionReason): Promise<void> {
    const { session, secrets, clock, logger } = this.#deps
    // Re-sync right before writing: Claude Code may have rotated the live token since step 1.
    const live = await session.readCurrentLogin()
    const findOurs = (id: AccountId) => tick.config.accounts.find((account) => account.id === id)
    if (live && tick.liveId && live.account.accountUuid === tick.liveId && findOurs(tick.liveId)) {
      await secrets.set(tick.liveId, live.oauth)
    }
    const target = findOurs(to) as StoredAccount
    const tokens = await secrets.get(to)
    if (!tokens) throw new Error(`no tokens stored for account ${to}`)
    await session.writeLogin(tokens, target.oauthAccount)
    recordActivity(tick, { t: clock.now(), type: 'swap', from: tick.liveId, to, reason })
    logger.info('swapped account', { from: tick.liveId, to, reason })
    tick.state = { ...tick.state, lastActiveId: to }
    tick.liveId = to
  }
}

function recordActivity(tick: TickContext, entry: ActivityEntry): void {
  tick.state = { ...tick.state, activity: [...tick.state.activity, entry] }
}

function patchAccount(tick: TickContext, id: AccountId, patch: Partial<StoredAccount>): void {
  tick.config = {
    ...tick.config,
    accounts: tick.config.accounts.map((account) =>
      account.id === id ? { ...account, ...patch } : account,
    ),
  }
  tick.configDirty = true
}

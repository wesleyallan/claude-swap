// Use cases: plain functions over a `deps` object. Mutations run under the shared mutex (so they
// never interleave with an engine tick) and then poke the engine without awaiting the tick.
import type { AccountId } from '@/domain/account'
import { AccountNotFoundError } from '@/domain/errors'
import { applyOrder, promoteAccount as promote } from '@/domain/ordering'
import type { Preferences } from '@/domain/preferences'
import type { EngineControl, EngineStatus } from '../engine'
import type {
  ActivityEntry,
  AppState,
  ClaudeCodeSession,
  Clock,
  ConfigRepository,
  HistoryPoint,
  Mutex,
  SecretsRepository,
  StateRepository,
  StoredAccount,
} from '../ports'

export interface UseCaseDeps {
  readonly config: ConfigRepository
  readonly secrets: SecretsRepository
  readonly state: StateRepository
  readonly session: ClaudeCodeSession
  readonly clock: Clock
  readonly mutex: Mutex
  readonly engine: EngineControl
}

/** Claude Code is not logged in, so there is nothing to import. */
export class NotLoggedInError extends Error {
  override readonly name = 'NotLoggedInError'
  constructor() {
    super('Claude Code is not logged in')
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

async function appendActivity(d: UseCaseDeps, entry: ActivityEntry): Promise<void> {
  const s = await d.state.load()
  await d.state.save({ ...s, activity: [...s.activity, entry] })
}

/** Loads the accounts, applies `fn`, saves. Throws `AccountNotFoundError` for an unknown `id`. */
async function updateAccounts(
  d: UseCaseDeps,
  id: AccountId,
  fn: (accounts: readonly StoredAccount[]) => StoredAccount[],
): Promise<void> {
  const config = await d.config.load()
  if (!config.accounts.some((a) => a.id === id)) throw new AccountNotFoundError(id)
  await d.config.save({ ...config, accounts: fn(config.accounts) })
}

const patchAccount = (d: UseCaseDeps, id: AccountId, patch: Partial<StoredAccount>) =>
  updateAccounts(d, id, (list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)))

/**
 * Snapshots the live Claude Code login (tokens + identity). New accounts go to the bottom of the
 * list; re-importing an existing one refreshes its tokens/identity and clears `needsReauth`.
 */
export async function importCurrentLogin(d: UseCaseDeps): Promise<StoredAccount> {
  const account = await d.mutex.run(async () => {
    const login = await d.session.readCurrentLogin()
    if (!login) throw new NotLoggedInError()
    const { oauth, account: identity } = login
    const config = await d.config.load()
    const existing = config.accounts.find((a) => a.id === identity.accountUuid)
    const fresh = {
      email: identity.emailAddress,
      organizationName: str(identity.organizationName),
      subscriptionType: str(oauth.subscriptionType),
      needsReauth: false,
      oauthAccount: identity,
    }
    const saved: StoredAccount = existing
      ? { ...existing, ...fresh }
      : {
          id: identity.accountUuid,
          label: str(identity.displayName) ?? identity.emailAddress,
          enabled: true,
          addedAt: d.clock.now(),
          ...fresh,
        }
    await d.secrets.set(saved.id, oauth)
    await d.config.save({
      ...config,
      accounts: existing
        ? config.accounts.map((a) => (a.id === saved.id ? saved : a))
        : [...config.accounts, saved],
    })
    if (!existing) {
      await appendActivity(d, { t: d.clock.now(), type: 'account-added', accountId: saved.id })
    }
    return saved
  })
  void d.engine.runNow()
  return account
}

/** Forgets the account, its tokens and its current usage (history points stay until they age out). */
export async function removeAccount(d: UseCaseDeps, id: AccountId): Promise<void> {
  await d.mutex.run(async () => {
    await updateAccounts(d, id, (list) => list.filter((a) => a.id !== id))
    await d.secrets.delete(id)
    const s = await d.state.load()
    const { [id]: _, ...usage } = s.usage
    await d.state.save({
      ...s,
      usage,
      activity: [...s.activity, { t: d.clock.now(), type: 'account-removed', accountId: id }],
    })
  })
  void d.engine.runNow({ manual: true })
}

/** Drag & drop: `ids` must list every account exactly once (`InvalidOrderError` otherwise). */
export async function reorderAccounts(d: UseCaseDeps, ids: readonly AccountId[]): Promise<void> {
  await d.mutex.run(async () => {
    const config = await d.config.load()
    await d.config.save({ ...config, accounts: applyOrder(config.accounts, ids) })
  })
  void d.engine.runNow({ manual: true })
}

/** "Use now": move the account to the top (manual swap = reorder). */
export async function promoteAccount(d: UseCaseDeps, id: AccountId): Promise<void> {
  await d.mutex.run(() => updateAccounts(d, id, (list) => promote(list, id)))
  void d.engine.runNow({ manual: true })
}

export async function setAccountEnabled(
  d: UseCaseDeps,
  id: AccountId,
  enabled: boolean,
): Promise<void> {
  await d.mutex.run(() => patchAccount(d, id, { enabled }))
  void d.engine.runNow({ manual: true })
}

/** Label only: cannot change the active account, so the engine is not poked. */
export async function renameAccount(d: UseCaseDeps, id: AccountId, label: string): Promise<void> {
  await d.mutex.run(() => patchAccount(d, id, { label }))
}

/** Shallow merge (pass `thresholds` whole). The engine re-reads `pollIntervalSec` on its next tick. */
export async function updatePreferences(
  d: UseCaseDeps,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const preferences = await d.mutex.run(async () => {
    const config = await d.config.load()
    const next = { ...config.preferences, ...patch }
    await d.config.save({ ...config, preferences: next })
    return next
  })
  void d.engine.runNow()
  return preferences
}

export interface Dashboard {
  readonly preferences: Preferences
  /** Priority order. Carries no tokens (they live only in `SecretsRepository`). */
  readonly accounts: readonly StoredAccount[]
  readonly usage: AppState['usage']
  readonly history: readonly HistoryPoint[]
  readonly activity: readonly ActivityEntry[]
  readonly activeId: AccountId | null
  readonly engine: EngineStatus
}

export async function getDashboard(
  d: Pick<UseCaseDeps, 'config' | 'state' | 'engine'>,
): Promise<Dashboard> {
  const [config, state] = await Promise.all([d.config.load(), d.state.load()])
  return {
    preferences: config.preferences,
    accounts: config.accounts,
    usage: state.usage,
    history: state.history,
    activity: state.activity,
    activeId: state.lastActiveId,
    engine: d.engine.status(),
  }
}

// Mutations run under the shared mutex so they never interleave with an engine tick.
import { type AccountId, type AccountStatus, accountStatus } from '@/domain/account'
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

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

async function appendActivity(deps: UseCaseDeps, entry: ActivityEntry): Promise<void> {
  const state = await deps.state.load()
  await deps.state.save({ ...state, activity: [...state.activity, entry] })
}

/** Loads the accounts, applies `change`, saves. Throws `AccountNotFoundError` for an unknown `id`. */
async function updateAccounts(
  deps: UseCaseDeps,
  id: AccountId,
  change: (accounts: readonly StoredAccount[]) => StoredAccount[],
): Promise<void> {
  const config = await deps.config.load()
  if (!config.accounts.some((account) => account.id === id)) throw new AccountNotFoundError(id)
  await deps.config.save({ ...config, accounts: change(config.accounts) })
}

const patchAccount = (deps: UseCaseDeps, id: AccountId, patch: Partial<StoredAccount>) =>
  updateAccounts(deps, id, (accounts) =>
    accounts.map((account) => (account.id === id ? { ...account, ...patch } : account)),
  )

export interface CurrentLogin {
  readonly id: AccountId
  readonly email: string
  /** Already in our list: importing it again only refreshes its tokens. */
  readonly known: boolean
}

/** Who Claude Code is logged in as right now (`null` when it is not), for the "Add account" modal. */
export async function getCurrentLogin(deps: UseCaseDeps): Promise<CurrentLogin | null> {
  const login = await deps.session.readCurrentLogin()
  if (!login) return null
  const { accountUuid: id, emailAddress: email } = login.account
  const known = (await deps.config.load()).accounts.some((account) => account.id === id)
  return { id, email, known }
}

/**
 * Snapshots the live Claude Code login (tokens + identity). New accounts go to the bottom of the
 * list; re-importing an existing one refreshes its tokens/identity and clears `needsReauth`.
 * A non-blank `label` (trimmed) names the account, new or re-imported.
 */
export async function importCurrentLogin(
  deps: UseCaseDeps,
  options: { label?: string | undefined } = {},
): Promise<StoredAccount> {
  const label = options.label?.trim() || undefined
  const account = await deps.mutex.run(async () => {
    const login = await deps.session.readCurrentLogin()
    if (!login) throw new NotLoggedInError()
    const { oauth, account: identity } = login
    const config = await deps.config.load()
    const existing = config.accounts.find((account) => account.id === identity.accountUuid)
    const fresh = {
      email: identity.emailAddress,
      organizationName: nonEmptyString(identity.organizationName),
      subscriptionType: nonEmptyString(oauth.subscriptionType),
      needsReauth: false,
      oauthAccount: identity,
    }
    const saved: StoredAccount = existing
      ? { ...existing, ...fresh, ...(label && { label }) }
      : {
          id: identity.accountUuid,
          label: label ?? nonEmptyString(identity.displayName) ?? identity.emailAddress,
          enabled: true,
          addedAt: deps.clock.now(),
          ...fresh,
        }
    await deps.secrets.set(saved.id, oauth)
    await deps.config.save({
      ...config,
      accounts: existing
        ? config.accounts.map((account) => (account.id === saved.id ? saved : account))
        : [...config.accounts, saved],
    })
    if (!existing) {
      await appendActivity(deps, {
        t: deps.clock.now(),
        type: 'account-added',
        accountId: saved.id,
      })
    }
    return saved
  })
  void deps.engine.runNow()
  return account
}

/** Forgets the account, its tokens and its current usage (history points stay until they age out). */
export async function removeAccount(deps: UseCaseDeps, id: AccountId): Promise<void> {
  await deps.mutex.run(async () => {
    await updateAccounts(deps, id, (accounts) => accounts.filter((account) => account.id !== id))
    await deps.secrets.delete(id)
    const state = await deps.state.load()
    const { [id]: _removed, ...usage } = state.usage
    await deps.state.save({
      ...state,
      usage,
      activity: [
        ...state.activity,
        { t: deps.clock.now(), type: 'account-removed', accountId: id },
      ],
    })
  })
  void deps.engine.runNow({ manual: true })
}

/** Drag & drop: `ids` must list every account exactly once (`InvalidOrderError` otherwise). */
export async function reorderAccounts(deps: UseCaseDeps, ids: readonly AccountId[]): Promise<void> {
  await deps.mutex.run(async () => {
    const config = await deps.config.load()
    await deps.config.save({ ...config, accounts: applyOrder(config.accounts, ids) })
  })
  await deps.engine.runNow({ manual: true })
}

/**
 * "Use now": move the account to the top (manual swap = reorder). Like reorder and enable, it
 * resolves after the engine tick, so the next dashboard fetch already shows the swap.
 */
export async function promoteAccount(deps: UseCaseDeps, id: AccountId): Promise<void> {
  await deps.mutex.run(() => updateAccounts(deps, id, (accounts) => promote(accounts, id)))
  await deps.engine.runNow({ manual: true })
}

export async function setAccountEnabled(
  deps: UseCaseDeps,
  id: AccountId,
  enabled: boolean,
): Promise<void> {
  await deps.mutex.run(() => patchAccount(deps, id, { enabled }))
  await deps.engine.runNow({ manual: true })
}

/** Label only: cannot change the active account, so the engine is not poked. */
export async function renameAccount(
  deps: UseCaseDeps,
  id: AccountId,
  label: string,
): Promise<void> {
  await deps.mutex.run(() => patchAccount(deps, id, { label }))
}

/** Shallow merge (pass `thresholds` whole). The engine re-reads `pollIntervalSec` on its next tick. */
export async function updatePreferences(
  deps: UseCaseDeps,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const preferences = await deps.mutex.run(async () => {
    const config = await deps.config.load()
    const next = { ...config.preferences, ...patch }
    await deps.config.save({ ...config, preferences: next })
    return next
  })
  void deps.engine.runNow()
  return preferences
}

export interface Dashboard {
  readonly preferences: Preferences
  /** Priority order. Carries no tokens (they live only in `SecretsRepository`). */
  readonly accounts: readonly StoredAccount[]
  /** Per account id, derived from the account, its last snapshot and the thresholds right now. */
  readonly statuses: Readonly<Record<AccountId, AccountStatus>>
  readonly usage: AppState['usage']
  readonly activity: readonly ActivityEntry[]
  readonly activeId: AccountId | null
  readonly engine: EngineStatus
}

export async function getDashboard(
  deps: Pick<UseCaseDeps, 'config' | 'state' | 'engine' | 'clock'>,
): Promise<Dashboard> {
  const [config, state] = await Promise.all([deps.config.load(), deps.state.load()])
  const now = deps.clock.now()
  return {
    preferences: config.preferences,
    accounts: config.accounts,
    statuses: Object.fromEntries(
      config.accounts.map((account) => [
        account.id,
        accountStatus(account, state.usage[account.id], config.preferences.thresholds, now),
      ]),
    ),
    usage: state.usage,
    activity: state.activity,
    activeId: state.lastActiveId,
    engine: deps.engine.status(),
  }
}

/** Served apart from the dashboard: it only changes once per engine tick. */
export async function getHistory(
  deps: Pick<UseCaseDeps, 'state'>,
): Promise<readonly HistoryPoint[]> {
  return (await deps.state.load()).history
}

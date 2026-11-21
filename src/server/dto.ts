// The only path from server data to the browser. Every field is picked explicitly, so tokens and
// the Claude Code identity snapshot (`oauthAccount`) can never leak (see dto.test.ts).
import type { ActivityEntry, HistoryPoint, StoredAccount } from '@/application/ports'
import type { Dashboard } from '@/application/use-cases'
import type { UsageSnapshot, UsageWindow } from '@/domain/usage'

const toIsoOrNull = (date: Date | null) => (date ? date.toISOString() : null)

export const toAccountDto = (account: StoredAccount) => ({
  id: account.id,
  label: account.label,
  email: account.email,
  organizationName: account.organizationName,
  subscriptionType: account.subscriptionType,
  enabled: account.enabled,
  needsReauth: account.needsReauth,
  addedAt: account.addedAt.toISOString(),
})

const toWindowDto = (window: UsageWindow | null) =>
  window && { utilization: window.utilization, resetsAt: toIsoOrNull(window.resetsAt) }

const toUsageDto = (snapshot: UsageSnapshot) => ({
  fiveHour: toWindowDto(snapshot.fiveHour),
  sevenDay: toWindowDto(snapshot.sevenDay),
  fetchedAt: snapshot.fetchedAt.toISOString(),
  ...(snapshot.error !== undefined && { error: snapshot.error }),
})

const toActivityDto = (entry: ActivityEntry) =>
  entry.type === 'swap'
    ? {
        t: entry.t.toISOString(),
        type: entry.type,
        from: entry.from,
        to: entry.to,
        reason: entry.reason,
      }
    : {
        t: entry.t.toISOString(),
        type: entry.type,
        ...(entry.accountId !== undefined && { accountId: entry.accountId }),
        ...(entry.message !== undefined && { message: entry.message }),
      }

export const toDashboardDto = (dashboard: Dashboard) => ({
  preferences: dashboard.preferences,
  accounts: dashboard.accounts.map((account) => ({
    ...toAccountDto(account),
    status: dashboard.statuses[account.id] ?? 'unknown',
  })),
  usage: Object.fromEntries(
    Object.entries(dashboard.usage).map(([id, snapshot]) => [id, toUsageDto(snapshot)]),
  ),
  activity: dashboard.activity.map(toActivityDto),
  activeId: dashboard.activeId,
  engine: {
    running: dashboard.engine.running,
    lastTickAt: toIsoOrNull(dashboard.engine.lastTickAt),
    nextTickAt: toIsoOrNull(dashboard.engine.nextTickAt),
    /** Email of a Claude Code login that is not imported; the engine does not swap while set. */
    unknownLogin: dashboard.engine.unknownLogin,
  },
})

export const toHistoryDto = (history: readonly HistoryPoint[]) =>
  history.map((point) => ({
    t: point.t.toISOString(),
    accountId: point.accountId,
    fiveHour: point.fiveHour,
    sevenDay: point.sevenDay,
  }))

export type DashboardDto = ReturnType<typeof toDashboardDto>
export type AccountDto = ReturnType<typeof toAccountDto>

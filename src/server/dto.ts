// The only path from server data to the browser. Every field is picked explicitly, so tokens and
// the Claude Code identity snapshot (`oauthAccount`) can never leak (see dto.test.ts).
import type { ActivityEntry, HistoryPoint, StoredAccount } from '@/application/ports'
import type { Dashboard } from '@/application/use-cases'
import type { UsageSnapshot, UsageWindow } from '@/domain/usage'

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export const toAccountDto = (a: StoredAccount) => ({
  id: a.id,
  label: a.label,
  email: a.email,
  organizationName: a.organizationName,
  subscriptionType: a.subscriptionType,
  enabled: a.enabled,
  needsReauth: a.needsReauth,
  addedAt: a.addedAt.toISOString(),
})

const toWindowDto = (w: UsageWindow | null) =>
  w && { utilization: w.utilization, resetsAt: iso(w.resetsAt) }

const toUsageDto = (s: UsageSnapshot) => ({
  fiveHour: toWindowDto(s.fiveHour),
  sevenDay: toWindowDto(s.sevenDay),
  fetchedAt: s.fetchedAt.toISOString(),
  ...(s.error !== undefined && { error: s.error }),
})

const toActivityDto = (e: ActivityEntry) =>
  e.type === 'swap'
    ? { t: e.t.toISOString(), type: e.type, from: e.from, to: e.to, reason: e.reason }
    : {
        t: e.t.toISOString(),
        type: e.type,
        ...(e.accountId !== undefined && { accountId: e.accountId }),
        ...(e.message !== undefined && { message: e.message }),
      }

export const toDashboardDto = (d: Dashboard) => ({
  preferences: d.preferences,
  accounts: d.accounts.map((a) => ({ ...toAccountDto(a), status: d.statuses[a.id] ?? 'unknown' })),
  usage: Object.fromEntries(Object.entries(d.usage).map(([id, s]) => [id, toUsageDto(s)])),
  activity: d.activity.map(toActivityDto),
  activeId: d.activeId,
  engine: {
    running: d.engine.running,
    lastTickAt: iso(d.engine.lastTickAt),
    nextTickAt: iso(d.engine.nextTickAt),
    /** Email of a Claude Code login that is not imported; the engine does not swap while set. */
    unknownLogin: d.engine.unknownLogin,
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

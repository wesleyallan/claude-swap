import { describe, expect, it } from 'vitest'
import { type Account, type AccountStatus, accountStatus } from './account'
import type { UsageSnapshot } from './usage'

const now = new Date('2026-01-01T12:00:00Z')
const later = new Date(now.getTime() + 60_000)
const thresholds = { fiveHour: 95, sevenDay: 98 }
const account = (patch: Partial<Account> = {}): Account => ({
  id: 'a',
  label: 'A',
  email: 'a@example.test',
  organizationName: null,
  subscriptionType: 'max',
  enabled: true,
  needsReauth: false,
  addedAt: now,
  ...patch,
})
const snap = (fiveHour: number | null, error?: string): UsageSnapshot => ({
  fiveHour: fiveHour === null ? null : { utilization: fiveHour, resetsAt: later },
  sevenDay: null,
  fetchedAt: now,
  ...(error && { error }),
})

describe('accountStatus', () => {
  it.each<[string, Account, UsageSnapshot | undefined, AccountStatus]>([
    ['usable', account(), snap(10), 'ok'],
    ['over a threshold', account(), snap(95), 'exhausted'],
    ['never polled', account(), undefined, 'unknown'],
    ['polled without any window', account(), snap(null, 'boom'), 'unknown'],
    ['last poll failed but a snapshot is kept', account(), snap(10, 'boom'), 'ok'],
    [
      'disabled wins over everything',
      account({ enabled: false, needsReauth: true }),
      snap(100),
      'disabled',
    ],
    [
      'needs re-auth wins over exhaustion',
      account({ needsReauth: true }),
      snap(100),
      'needs-reauth',
    ],
  ])('%s → %s', (_, a, s, expected) => {
    expect(accountStatus(a, s, thresholds, now)).toBe(expected)
  })
})

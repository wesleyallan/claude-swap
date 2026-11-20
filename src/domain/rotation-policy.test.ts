import { describe, expect, it } from 'vitest'
import type { Account, AccountId } from './account'
import type { Thresholds } from './preferences'
import { type Selection, selectActiveAccount } from './rotation-policy'
import type { UsageSnapshot } from './usage'

const now = new Date('2026-01-01T12:00:00Z')
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
const thresholds: Thresholds = { fiveHour: 95, sevenDay: 98 }

function account(id: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    label: id,
    email: `${id}@example.test`,
    organizationName: null,
    subscriptionType: 'max',
    enabled: true,
    needsReauth: false,
    addedAt: now,
    ...extra,
  }
}

const ok: UsageSnapshot = {
  fiveHour: { utilization: 10, resetsAt: at(60) },
  sevenDay: { utilization: 10, resetsAt: at(60 * 24) },
  fetchedAt: now,
}
const exhausted = (resetInMinutes: number): UsageSnapshot => ({
  fiveHour: { utilization: 100, resetsAt: at(resetInMinutes) },
  sevenDay: { utilization: 10, resetsAt: at(60 * 24) },
  fetchedAt: now,
})

const [A, B, C] = [account('a'), account('b'), account('c')]

type Case = {
  name: string
  accounts: Account[]
  usage?: Record<AccountId, UsageSnapshot>
  autoRotate?: boolean
  currentId?: AccountId | null
  expected: Selection | null
}

const cases: Case[] = [
  { name: 'empty list → null', accounts: [], expected: null },
  {
    name: 'no candidates (disabled / needsReauth) → null',
    accounts: [account('a', { enabled: false }), account('b', { needsReauth: true })],
    expected: null,
  },
  {
    name: 'first run, top account fine → top-priority',
    accounts: [A, B],
    usage: { a: ok, b: ok },
    currentId: null,
    expected: { id: 'a', reason: 'top-priority' },
  },
  {
    name: 'no usage known yet → top-priority (unknown is not blocked)',
    accounts: [A, B],
    expected: { id: 'a', reason: 'top-priority' },
  },
  {
    name: 'current is top and fine → top-priority',
    accounts: [A, B],
    usage: { a: ok, b: ok },
    currentId: 'a',
    expected: { id: 'a', reason: 'top-priority' },
  },
  {
    name: 'skips disabled and needsReauth',
    accounts: [account('a', { enabled: false }), account('b', { needsReauth: true }), C],
    currentId: 'c',
    expected: { id: 'c', reason: 'top-priority' },
  },
  {
    name: 'current exhausted → next one, auto-exhausted',
    accounts: [A, B, C],
    usage: { a: exhausted(30), b: ok, c: ok },
    currentId: 'a',
    expected: { id: 'b', reason: 'auto-exhausted' },
  },
  {
    name: 'stays on lower account while higher still exhausted → auto-exhausted',
    accounts: [A, B],
    usage: { a: exhausted(30), b: ok },
    currentId: 'b',
    expected: { id: 'b', reason: 'auto-exhausted' },
  },
  {
    name: 'first run with top exhausted → auto-exhausted',
    accounts: [A, B],
    usage: { a: exhausted(30) },
    currentId: null,
    expected: { id: 'b', reason: 'auto-exhausted' },
  },
  {
    name: 'higher account reset → swap back up, auto-reset',
    accounts: [A, B, C],
    usage: { a: ok, b: exhausted(30), c: ok },
    currentId: 'c',
    expected: { id: 'a', reason: 'auto-reset' },
  },
  {
    name: 'window reset exactly now counts as reset → auto-reset',
    accounts: [A, B],
    usage: { a: exhausted(0), b: ok },
    currentId: 'b',
    expected: { id: 'a', reason: 'auto-reset' },
  },
  {
    name: 'current id no longer in list → treated as first run',
    accounts: [A, B],
    usage: { a: exhausted(30) },
    currentId: 'gone',
    expected: { id: 'b', reason: 'auto-exhausted' },
  },
  {
    name: 'all exhausted, current still candidate → keep current',
    accounts: [A, B, C],
    usage: { a: exhausted(10), b: exhausted(300), c: exhausted(20) },
    currentId: 'b',
    expected: { id: 'b', reason: 'all-exhausted' },
  },
  {
    name: 'all exhausted, current gone → earliest to recover',
    accounts: [A, B, C],
    usage: { a: exhausted(300), b: exhausted(20), c: exhausted(10) },
    currentId: null,
    expected: { id: 'c', reason: 'all-exhausted' },
  },
  {
    name: 'all exhausted, current disabled → earliest to recover, ties keep order',
    accounts: [account('a', { enabled: false }), B, C],
    usage: { a: exhausted(1), b: exhausted(20), c: exhausted(20) },
    currentId: 'a',
    expected: { id: 'b', reason: 'all-exhausted' },
  },
  {
    name: 'all exhausted: recovery waits for the latest exhausted window',
    accounts: [A, B],
    usage: {
      a: {
        fiveHour: { utilization: 100, resetsAt: at(5) },
        sevenDay: { utilization: 100, resetsAt: at(60 * 24) },
        fetchedAt: now,
      },
      b: exhausted(60),
    },
    expected: { id: 'b', reason: 'all-exhausted' },
  },
  {
    name: 'manual mode → first candidate even if exhausted',
    accounts: [account('a', { needsReauth: true }), B, C],
    usage: { b: exhausted(30), c: ok },
    autoRotate: false,
    currentId: 'c',
    expected: { id: 'b', reason: 'manual' },
  },
  {
    name: 'manual mode with no candidates → null',
    accounts: [account('a', { enabled: false })],
    autoRotate: false,
    expected: null,
  },
]

describe('selectActiveAccount', () => {
  it.each(cases)(
    '$name',
    ({ accounts, usage = {}, autoRotate = true, currentId = null, expected }) => {
      expect(
        selectActiveAccount({ accounts, usage, thresholds, now, autoRotate, currentId }),
      ).toEqual(expected)
    },
  )
})

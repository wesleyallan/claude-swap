import { describe, expect, it } from 'vitest'
import {
  chartRows,
  lastTickError,
  move,
  nextReset,
  swapsSince,
  timeTicks,
  usageTone,
} from './model'

const iso = (ms: number) => new Date(ms).toISOString()

describe('usageTone', () => {
  it.each([
    [0, 95, 'success'],
    [79.9, 95, 'success'],
    [80, 95, 'warning'],
    [94.9, 95, 'warning'],
    [95, 95, 'error'],
    [100, 98, 'error'],
    [60, 50, 'error'], // a threshold below the warning band still reads as error
  ] as const)('%s%% with threshold %s → %s', (u, threshold, tone) => {
    expect(usageTone(u, threshold)).toBe(tone)
  })
})

describe('chartRows', () => {
  const history = [
    { t: iso(1000), accountId: 'a', fiveHour: 10, sevenDay: 1 },
    { t: iso(1000), accountId: 'b', fiveHour: 20, sevenDay: null },
    { t: iso(2000), accountId: 'a', fiveHour: 30, sevenDay: 3 },
    { t: iso(500), accountId: 'a', fiveHour: 99, sevenDay: 9 }, // before `since`
    { t: iso(1500), accountId: 'gone', fiveHour: 50, sevenDay: 5 }, // removed account
  ]
  it('merges points by time, one key per account index, skipping old and unknown ones', () => {
    expect(chartRows(history, ['a', 'b'], 'fiveHour', 600)).toEqual([
      { t: 1000, s0: 10, s1: 20 },
      { t: 2000, s0: 30 },
    ])
    expect(chartRows(history, ['b', 'a'], 'sevenDay', 0)).toEqual([
      { t: 500, s1: 9 },
      { t: 1000, s1: 1 },
      { t: 2000, s1: 3 },
    ])
  })
})

describe('nextReset', () => {
  const w = (resetsAt: string | null) => ({ utilization: 1, resetsAt })
  it('is the earliest future reset of enabled accounts', () => {
    const accounts = [
      { id: 'a', enabled: true },
      { id: 'b', enabled: true },
      { id: 'c', enabled: false },
    ]
    const usage = {
      a: { fiveHour: w(iso(5000)), sevenDay: w(iso(1000)), fetchedAt: iso(0) }, // 7d already passed
      b: { fiveHour: w(iso(4000)), sevenDay: null, fetchedAt: iso(0) },
      c: { fiveHour: w(iso(3000)), sevenDay: null, fetchedAt: iso(0) },
    }
    expect(nextReset(accounts, usage, new Date(2000))).toEqual(new Date(4000))
    expect(nextReset(accounts, {}, new Date(2000))).toBeNull()
  })
})

describe('swapsSince', () => {
  it('counts swap entries at or after the instant', () => {
    const activity = [
      { t: iso(1000), type: 'swap' },
      { t: iso(2000), type: 'error' },
      { t: iso(3000), type: 'swap' },
    ]
    expect(swapsSince(activity, new Date(2000))).toBe(1)
  })
})

describe('lastTickError', () => {
  const engine = (lastTickAt: string | null) => ({ lastTickAt })
  it('returns the newest error recorded during the last tick only', () => {
    const activity = [
      { t: iso(0), type: 'error', message: 'old' },
      { t: iso(100_000), type: 'error', message: 'recent' },
      { t: iso(100_500), type: 'swap' },
    ]
    expect(lastTickError(activity, engine(iso(101_000)))).toBe('recent')
    expect(lastTickError(activity, engine(iso(200_000)))).toBeNull()
    expect(lastTickError(activity, engine(null))).toBeNull()
    expect(lastTickError([{ t: iso(0), type: 'error' }], engine(iso(0)))).toBe('')
  })
})

describe('move', () => {
  it('moves an item between positions', () => {
    expect(move(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(move(['a'], 3, 0)).toEqual(['a'])
  })
})

describe('timeTicks', () => {
  const local = (h: number, m = 0) => new Date(2026, 10, 19, h, m).getTime()
  it('lands on local multiples of the step', () => {
    expect(timeTicks(local(1, 30), local(13), 4)).toEqual([local(4), local(8), local(12)])
    expect(timeTicks(local(4), local(8), 4)).toEqual([local(4), local(8)])
  })
  it('uses local midnights for daily ticks', () => {
    expect(timeTicks(local(10), local(10) + 2 * 86_400_000, 24)).toEqual([
      new Date(2026, 10, 20).getTime(),
      new Date(2026, 10, 21).getTime(),
    ])
  })
})

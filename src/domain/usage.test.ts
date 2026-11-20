import { describe, expect, it } from 'vitest'
import type { Thresholds } from './preferences'
import { exhaustedUntil, isExhausted, nextResetAt, type UsageSnapshot } from './usage'

const now = new Date('2026-01-01T12:00:00Z')
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
const thresholds: Thresholds = { fiveHour: 95, sevenDay: 98 }

function snap(
  fiveHour: [number, Date | null] | null,
  sevenDay: [number, Date | null] | null = [0, at(60 * 24)],
): UsageSnapshot {
  const w = (v: [number, Date | null] | null) => v && { utilization: v[0], resetsAt: v[1] }
  return { fiveHour: w(fiveHour), sevenDay: w(sevenDay), fetchedAt: now }
}

describe('isExhausted', () => {
  it.each<[string, UsageSnapshot | undefined, boolean]>([
    ['missing snapshot (unknown is not blocked)', undefined, false],
    ['both windows null', snap(null, null), false],
    ['below both thresholds', snap([94.9, at(10)], [97.9, at(10)]), false],
    ['5h exactly at threshold', snap([95, at(10)]), true],
    ['5h above threshold', snap([100, at(10)]), true],
    ['7d exactly at threshold', snap([0, at(10)], [98, at(10)]), true],
    ['5h full but resetsAt == now (already reset)', snap([100, now]), false],
    ['5h full but resetsAt in the past', snap([100, at(-1)]), false],
    ['5h full but resetsAt unknown', snap([100, null]), false],
    ['7d full, resets in 1 ms', snap([0, null], [100, new Date(now.getTime() + 1)]), true],
  ])('%s → %s', (_, snapshot, expected) => {
    expect(isExhausted(snapshot, thresholds, now)).toBe(expected)
  })
})

describe('nextResetAt', () => {
  it.each<[string, UsageSnapshot, Date | null]>([
    ['earliest of both windows', snap([10, at(30)], [10, at(90)]), at(30)],
    ['7d earlier than 5h', snap([10, at(300)], [10, at(5)]), at(5)],
    ['ignores null resetsAt', snap([10, null], [10, at(90)]), at(90)],
    ['ignores null windows', snap(null, [10, at(90)]), at(90)],
    ['nothing known', snap(null, [10, null]), null],
  ])('%s', (_, snapshot, expected) => {
    expect(nextResetAt(snapshot)).toEqual(expected)
  })
})

describe('exhaustedUntil', () => {
  it.each<[string, UsageSnapshot | undefined, Date | null]>([
    ['not exhausted', snap([10, at(30)]), null],
    ['missing snapshot', undefined, null],
    ['only 5h exhausted', snap([100, at(30)], [10, at(900)]), at(30)],
    ['both exhausted → latest reset', snap([100, at(30)], [100, at(900)]), at(900)],
    ['7d exhausted, 5h exhausted but expired', snap([100, at(-5)], [100, at(900)]), at(900)],
  ])('%s', (_, snapshot, expected) => {
    expect(exhaustedUntil(snapshot, thresholds, now)).toEqual(expected)
  })
})

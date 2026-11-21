import type { Thresholds } from './preferences'

export interface UsageWindow {
  /** 0–100. */
  readonly utilization: number
  readonly resetsAt: Date | null
}

export interface UsageSnapshot {
  readonly fiveHour: UsageWindow | null
  readonly sevenDay: UsageWindow | null
  readonly fetchedAt: Date
  readonly error?: string
}

const windowsWithThresholds = (snapshot: UsageSnapshot, thresholds: Thresholds) =>
  [
    [snapshot.fiveHour, thresholds.fiveHour],
    [snapshot.sevenDay, thresholds.sevenDay],
  ] as const

/**
 * Reset times of the windows that block the account right now. A window blocks only while
 * `utilization >= threshold` and `resetsAt > now`; a past or unknown `resetsAt` never blocks.
 */
function blockingResets(snapshot: UsageSnapshot, thresholds: Thresholds, now: Date): Date[] {
  return windowsWithThresholds(snapshot, thresholds).flatMap(([window, threshold]) =>
    window?.resetsAt && window.resetsAt > now && window.utilization >= threshold
      ? [window.resetsAt]
      : [],
  )
}

/**
 * Whether the account must be skipped. A missing snapshot means "unknown", which is NOT
 * exhausted: an account we could not poll stays usable rather than being blocked forever.
 */
export function isExhausted(
  snapshot: UsageSnapshot | undefined,
  thresholds: Thresholds,
  now: Date,
): boolean {
  return snapshot !== undefined && blockingResets(snapshot, thresholds, now).length > 0
}

/** When the account becomes usable again (latest blocking reset), or null if not exhausted. */
export function exhaustedUntil(
  snapshot: UsageSnapshot | undefined,
  thresholds: Thresholds,
  now: Date,
): Date | null {
  const resets = snapshot ? blockingResets(snapshot, thresholds, now) : []
  return resets.length ? new Date(Math.max(...resets.map(Number))) : null
}

/** Earliest known reset of either window (for countdowns), or null if none is known. */
export function nextResetAt(snapshot: UsageSnapshot): Date | null {
  const resets = [snapshot.fiveHour?.resetsAt, snapshot.sevenDay?.resetsAt].filter(
    (reset): reset is Date => reset instanceof Date,
  )
  return resets.length ? new Date(Math.min(...resets.map(Number))) : null
}

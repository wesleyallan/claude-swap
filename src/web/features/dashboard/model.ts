// Display-only helpers: business rules (exhaustion, status) stay on the server.

export type Tone = 'success' | 'warning' | 'error'
export type UsageWindowKey = 'fiveHour' | 'sevenDay'

/** Utilization (%) from which a bar turns amber, before it reaches the swap threshold. */
const WARNING_FROM = 80

export const usageTone = (utilization: number, threshold: number): Tone =>
  utilization >= threshold ? 'error' : utilization >= WARNING_FROM ? 'warning' : 'success'

interface HistoryPoint {
  readonly t: string
  readonly accountId: string
  readonly fiveHour: number | null
  readonly sevenDay: number | null
}

export type ChartRow = { t: number; [series: `s${number}`]: number }

/**
 * History merged into one row per timestamp (ms), series key `s<i>` = index of the account in
 * `ids`. Points older than `since` (ms), of unknown accounts or without a value are skipped.
 */
export function chartRows(
  history: readonly HistoryPoint[],
  ids: readonly string[],
  window: UsageWindowKey,
  since: number,
): ChartRow[] {
  const rows = new Map<number, ChartRow>()
  for (const point of history) {
    const time = Date.parse(point.t)
    const series = ids.indexOf(point.accountId)
    const value = point[window]
    if (time < since || series < 0 || value === null) continue
    const row = rows.get(time) ?? { t: time }
    row[`s${series}`] = value
    rows.set(time, row)
  }
  return [...rows.values()].sort((a, b) => a.t - b.t)
}

interface ResettingWindow {
  readonly resetsAt: string | null
}

/** Earliest reset still ahead of `now` across enabled accounts, or null. */
export function nextReset(
  accounts: readonly { id: string; enabled: boolean }[],
  usage: Readonly<
    Record<string, { fiveHour: ResettingWindow | null; sevenDay: ResettingWindow | null }>
  >,
  now: Date,
): Date | null {
  let earliest = Number.POSITIVE_INFINITY
  for (const account of accounts) {
    const accountUsage = account.enabled ? usage[account.id] : undefined
    for (const window of [accountUsage?.fiveHour, accountUsage?.sevenDay]) {
      const resetsAt = window?.resetsAt ? Date.parse(window.resetsAt) : Number.NaN
      if (resetsAt > now.getTime() && resetsAt < earliest) earliest = resetsAt
    }
  }
  return Number.isFinite(earliest) ? new Date(earliest) : null
}

export const swapsSince = (activity: readonly { t: string; type: string }[], since: Date) =>
  activity.filter((entry) => entry.type === 'swap' && Date.parse(entry.t) >= since.getTime()).length

/** A tick records its error before `lastTickAt` is set; anything older is from an earlier tick. */
const TICK_WINDOW_MS = 60_000

/**
 * Message of the error the last engine tick recorded ('' if it had none), or null when the last
 * tick went fine. shortcut: inferred from timestamps; expose it from the engine if ticks get slow.
 */
export function lastTickError(
  activity: readonly { t: string; type: string; message?: string | undefined }[],
  engine: { lastTickAt: string | null },
): string | null {
  if (!engine.lastTickAt) return null
  const tickEnd = Date.parse(engine.lastTickAt)
  const error = activity.findLast((entry) => entry.type === 'error')
  if (!error) return null
  const errorAt = Date.parse(error.t)
  return errorAt <= tickEnd && tickEnd - errorAt < TICK_WINDOW_MS ? (error.message ?? '') : null
}

/** `ids` with the item at `from` moved to `to`. */
export function move<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

/**
 * Axis ticks between `from` and `to` (ms) on local-time boundaries: every `stepHours` hours of
 * the day (a divisor of 24), or local midnights when `stepHours` is 24.
 */
export function timeTicks(from: number, to: number, stepHours: number): number[] {
  const tick = new Date(from)
  tick.setMinutes(0, 0, 0)
  tick.setHours(Math.ceil(tick.getHours() / stepHours) * stepHours) // rolls over to the next day at 24
  const ticks: number[] = []
  for (; tick.getTime() <= to; tick.setHours(tick.getHours() + stepHours)) {
    if (tick.getTime() >= from) ticks.push(tick.getTime())
  }
  return ticks
}

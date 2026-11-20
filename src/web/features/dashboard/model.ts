// Display-only helpers over the dashboard DTO. Business rules (exhaustion, status) stay on the
// server; these only shape data for charts, tiles and banners.

export type Tone = 'success' | 'warning' | 'error'
export type UsageWindowKey = 'fiveHour' | 'sevenDay'

/** Utilization (%) from which a bar turns amber, before it reaches the swap threshold. */
const WARNING_FROM = 80

export const usageTone = (utilization: number, threshold: number): Tone =>
  utilization >= threshold ? 'error' : utilization >= WARNING_FROM ? 'warning' : 'success'

interface Point {
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
  history: readonly Point[],
  ids: readonly string[],
  window: UsageWindowKey,
  since: number,
): ChartRow[] {
  const rows = new Map<number, ChartRow>()
  for (const p of history) {
    const t = Date.parse(p.t)
    const i = ids.indexOf(p.accountId)
    const v = p[window]
    if (t < since || i < 0 || v === null) continue
    const row = rows.get(t) ?? { t }
    row[`s${i}`] = v
    rows.set(t, row)
  }
  return [...rows.values()].sort((a, b) => a.t - b.t)
}

interface Win {
  readonly resetsAt: string | null
}

/** Earliest reset still ahead of `now` across enabled accounts, or null. */
export function nextReset(
  accounts: readonly { id: string; enabled: boolean }[],
  usage: Readonly<Record<string, { fiveHour: Win | null; sevenDay: Win | null }>>,
  now: Date,
): Date | null {
  let min = Number.POSITIVE_INFINITY
  for (const a of accounts) {
    const u = a.enabled ? usage[a.id] : undefined
    for (const w of [u?.fiveHour, u?.sevenDay]) {
      const t = w?.resetsAt ? Date.parse(w.resetsAt) : Number.NaN
      if (t > now.getTime() && t < min) min = t
    }
  }
  return Number.isFinite(min) ? new Date(min) : null
}

export const swapsSince = (activity: readonly { t: string; type: string }[], since: Date) =>
  activity.filter((e) => e.type === 'swap' && Date.parse(e.t) >= since.getTime()).length

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
  const end = Date.parse(engine.lastTickAt)
  const error = activity.findLast((e) => e.type === 'error')
  if (!error) return null
  const t = Date.parse(error.t)
  return t <= end && end - t < TICK_WINDOW_MS ? (error.message ?? '') : null
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
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  d.setHours(Math.ceil(d.getHours() / stepHours) * stepHours) // rolls over to the next day at 24
  const out: number[] = []
  for (; d.getTime() <= to; d.setHours(d.getHours() + stepHours)) {
    if (d.getTime() >= from) out.push(d.getTime())
  }
  return out
}

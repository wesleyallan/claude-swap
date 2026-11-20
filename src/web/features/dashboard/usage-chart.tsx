// Loaded lazily (Recharts is the heaviest UI dependency): see `dashboard.tsx`.
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { useFormatter, useNow, useTranslations } from 'use-intl'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/web/components/ui/chart'
import type { Dashboard } from '@/web/lib/api'
import { chartRows, timeTicks, type UsageWindowKey } from './model'

const HOUR_MS = 3_600_000
const RANGES: Record<UsageWindowKey, number> = {
  fiveHour: 24 * HOUR_MS,
  sevenDay: 7 * 24 * HOUR_MS,
}

interface PanelProps {
  window: UsageWindowKey
  data: Dashboard
  config: ChartConfig
}

function Panel({ window, data, config }: PanelProps) {
  const t = useTranslations('chart')
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const ids = data.accounts.map((a) => a.id)
  const rows = chartRows(data.history, ids, window, now.getTime() - RANGES[window])
  const pct = (v: number) => format.number(v / 100, { style: 'percent', maximumFractionDigits: 0 })
  // Only accounts with points in range get a line (and a legend entry).
  const series = data.accounts.flatMap((a, i) => {
    const last = rows.findLast((r) => r[`s${i}`] !== undefined)?.[`s${i}`]
    return last === undefined ? [] : [{ a, key: `s${i}`, last }]
  })
  const latest = series.map((s) => t('value', { name: s.a.label, value: pct(s.last) }))
  const from = now.getTime() - RANGES[window]
  const tick = (ms: number) =>
    window === 'fiveHour'
      ? format.dateTime(new Date(ms), { hour: 'numeric', minute: '2-digit' })
      : format.dateTime(new Date(ms), { weekday: 'short' })
  const titleId = `chart-${window}-title`
  return (
    <figure aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <figcaption id={titleId} className="font-medium text-sm">
        {t(window)}
      </figcaption>
      <p className="sr-only">
        {latest.length ? t('summary', { values: latest.join(', ') }) : t('summaryNone')}
      </p>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[from, now.getTime()]}
            ticks={timeTicks(from, now.getTime(), window === 'fiveHour' ? 4 : 24)}
            tickFormatter={tick}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={pct}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine
            y={data.preferences.thresholds[window]}
            stroke="var(--destructive)"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  format.dateTime(new Date(Number(payload[0]?.payload?.t)), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                }
                valueFormatter={pct}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
          {series.map(({ a, key }) => (
            <Line
              key={a.id}
              dataKey={key}
              name={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </figure>
  )
}

/** Utilization over time: one line per account, 5-hour and weekly windows side by side. */
export default function UsageChart({ data }: { data: Dashboard }) {
  const config: ChartConfig = Object.fromEntries(
    data.accounts.map((a, i) => [
      `s${i}`,
      { label: a.label, color: `var(--chart-${(i % 5) + 1})` },
    ]),
  )
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Panel window="fiveHour" data={data} config={config} />
      <Panel window="sevenDay" data={data} config={config} />
    </div>
  )
}

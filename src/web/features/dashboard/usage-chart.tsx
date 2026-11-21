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
import type { Account, Dashboard, HistoryPoint } from '@/web/lib/api'
import { chartRows, timeTicks, type UsageWindowKey } from './model'

const HOUR_MS = 3_600_000
const RANGE_MS: Record<UsageWindowKey, number> = {
  fiveHour: 24 * HOUR_MS,
  sevenDay: 7 * 24 * HOUR_MS,
}

interface UsageChartProps {
  history: readonly HistoryPoint[]
  accounts: readonly Account[]
  thresholds: Dashboard['preferences']['thresholds']
}

interface PanelProps extends UsageChartProps {
  window: UsageWindowKey
  config: ChartConfig
}

function Panel({ window, history, accounts, thresholds, config }: PanelProps) {
  const t = useTranslations('chart')
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const ids = accounts.map((account) => account.id)
  const from = now.getTime() - RANGE_MS[window]
  const rows = chartRows(history, ids, window, from)
  const percent = (value: number) =>
    format.number(value / 100, { style: 'percent', maximumFractionDigits: 0 })
  // Only accounts with points in range get a line (and a legend entry).
  const series = accounts.flatMap((account, index) => {
    const key = `s${index}` as const
    const latest = rows.findLast((row) => row[key] !== undefined)?.[key]
    return latest === undefined ? [] : [{ account, key, latest }]
  })
  const latestValues = series.map(({ account, latest }) =>
    t('value', { name: account.label, value: percent(latest) }),
  )
  const formatTick = (ms: number) =>
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
        {latestValues.length ? t('summary', { values: latestValues.join(', ') }) : t('summaryNone')}
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
            tickFormatter={formatTick}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={percent}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine
            y={thresholds[window]}
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
                valueFormatter={percent}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
          {series.map(({ account, key }) => (
            <Line
              key={account.id}
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
export default function UsageChart(props: UsageChartProps) {
  const config: ChartConfig = Object.fromEntries(
    props.accounts.map((account, index) => [
      `s${index}`,
      { label: account.label, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  )
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Panel window="fiveHour" config={config} {...props} />
      <Panel window="sevenDay" config={config} {...props} />
    </div>
  )
}

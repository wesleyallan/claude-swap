import { useFormatter, useNow, useTranslations } from 'use-intl'
import { Progress } from '@/web/components/ui/progress'
import { type Tone, usageTone } from './model'

const toneBg: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
}

interface Props {
  label: string
  longLabel: string
  window: { utilization: number; resetsAt: string | null } | null
  threshold: number
}

/** One usage window: %, a bar colored by how close it is to the swap threshold, reset countdown. */
export function UsageBar({ label, longLabel, window, threshold }: Props) {
  const t = useTranslations('accounts')
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const value = window ? Math.min(100, Math.max(0, window.utilization)) : 0
  const pct = window ? format.number(window.utilization / 100, { style: 'percent' }) : null
  const resetsAt = window?.resetsAt ? new Date(window.resetsAt) : null
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div aria-hidden className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct ?? t('noData')}</span>
      </div>
      <Progress
        value={value}
        aria-label={longLabel}
        getAriaValueText={() => pct ?? t('noData')}
        indicatorClassName={window ? toneBg[usageTone(window.utilization, threshold)] : undefined}
      />
      <p className="text-pretty text-muted-foreground text-xs">
        {resetsAt && resetsAt > now
          ? t('resets', { time: format.relativeTime(resetsAt, now) })
          : '\u00a0'}
      </p>
    </div>
  )
}

import { cn } from 'cn'
import { useFormatter, useNow, useTranslations } from 'use-intl'
import { Badge } from '@/web/components/ui/badge'
import { useDashboard } from '@/web/lib/query'

/** Header pill: auto/manual mode and the next engine check. */
export function EngineStatus() {
  const t = useTranslations('engine')
  const format = useFormatter()
  const now = useNow({ updateInterval: 10_000 })
  const { data, isError } = useDashboard()
  if (!data && !isError) return null

  let tone = 'bg-success'
  let text: string
  if (!data) {
    tone = 'bg-destructive'
    text = t('offline')
  } else if (data.engine.unknownLogin) {
    tone = 'bg-warning'
    text = t('paused')
  } else if (!data.preferences.autoRotate) {
    tone = 'bg-muted-foreground'
    text = t('manual')
  } else {
    const next = data.engine.nextTickAt
    text = next ? t('nextCheck', { time: format.relativeTime(new Date(next), now) }) : t('auto')
  }
  return (
    <Badge variant="outline" className="h-7 gap-2 px-3 max-sm:px-2.5" title={text}>
      <span aria-hidden className={cn('size-2 rounded-full', tone)} />
      <span className="sr-only">{t('label')}: </span>
      <span className="max-sm:sr-only">{text}</span>
    </Badge>
  )
}

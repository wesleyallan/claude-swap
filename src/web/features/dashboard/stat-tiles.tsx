import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useFormatter, useNow, useTranslations } from 'use-intl'
import type { Dashboard } from '@/web/lib/api'
import { nextReset, swapsSince } from './model'

const DAY_MS = 24 * 3_600_000

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-card p-5">
      <dt className="font-medium text-caption text-muted-foreground uppercase tracking-[1.5px]">
        {label}
      </dt>
      <dd className="truncate font-heading text-display-sm">{value}</dd>
      <dd className="text-pretty text-muted-foreground text-sm">{hint}</dd>
    </div>
  )
}

export function StatTiles({ data }: { data: Dashboard }) {
  const t = useTranslations('stats')
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const active = data.accounts.find((account) => account.id === data.activeId)
  const reset = nextReset(data.accounts, data.usage, now)
  const swaps = swapsSince(data.activity, new Date(now.getTime() - DAY_MS))
  const mode = data.engine.unknownLogin ? 'Paused' : data.preferences.autoRotate ? 'Auto' : 'Manual'
  return (
    <dl aria-label={t('label')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {data.engine.unknownLogin ? (
        <Tile label={t('active')} value={t('unknownActive')} hint={data.engine.unknownLogin} />
      ) : (
        <Tile
          label={t('active')}
          value={active?.label ?? t('noActive')}
          hint={active?.email ?? ' '}
        />
      )}
      <Tile
        label={t('nextReset')}
        value={reset ? format.relativeTime(reset, now) : t('noReset')}
        hint={
          reset
            ? format.dateTime(reset, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
            : ' '
        }
      />
      <Tile
        label={t('swaps')}
        value={format.number(swaps)}
        hint={t('swapsHint', { count: swaps })}
      />
      <Tile
        label={t('mode')}
        value={
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                'size-2.5 rounded-full',
                mode === 'Auto'
                  ? 'bg-success'
                  : mode === 'Paused'
                    ? 'bg-warning'
                    : 'bg-muted-foreground',
              )}
            />
            {t(`mode${mode}`)}
          </span>
        }
        hint={t(`mode${mode}Hint`)}
      />
    </dl>
  )
}

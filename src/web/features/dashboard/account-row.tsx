import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, Trash2Icon, ZapIcon } from 'lucide-react'
import type { Ref } from 'react'
import { useTranslations } from 'use-intl'
import { Badge } from '@/web/components/ui/badge'
import { Button } from '@/web/components/ui/button'
import { Switch } from '@/web/components/ui/switch'
import type { Account, AccountStatus, Usage } from '@/web/lib/api'
import { UsageBar } from './usage-bar'

const statusDot: Record<AccountStatus, string> = {
  ok: 'bg-success',
  exhausted: 'bg-destructive',
  'needs-reauth': 'bg-warning',
  disabled: 'bg-muted-foreground',
  unknown: 'border border-muted-foreground',
}

function StatusChip({ status }: { status: AccountStatus }) {
  const t = useTranslations('accounts.status')
  return (
    <Badge variant="outline" className="gap-1.5">
      <span aria-hidden className={cn('size-1.5 rounded-full', statusDot[status])} />
      {t(status)}
    </Badge>
  )
}

export interface AccountRowProps {
  account: Account
  usage: Usage | undefined
  index: number
  total: number
  active: boolean
  thresholds: { fiveHour: number; sevenDay: number }
  onPromote: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onEnabledChange: (id: string, enabled: boolean) => void
  rowRef?: Ref<HTMLLIElement>
  handleRef?: Ref<HTMLButtonElement>
  dragging?: boolean
}

export function AccountRow({
  account,
  usage,
  index,
  total,
  active,
  thresholds,
  onPromote,
  onMove,
  onEnabledChange,
  rowRef,
  handleRef,
  dragging,
}: AccountRowProps) {
  const t = useTranslations('accounts')
  const name = account.label
  const canPromote = index > 0 && account.enabled && !account.needsReauth
  return (
    <li
      ref={rowRef}
      data-active={active || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4 rounded-2xl border bg-background p-4 transition-shadow sm:gap-x-4 sm:p-5',
        'lg:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center',
        'data-active:border-brand/60 data-active:shadow-[0_0_0_1px_var(--brand)]',
        'data-dragging:z-10 data-dragging:shadow-lg',
        !account.enabled && 'bg-muted/60',
      )}
    >
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          ref={handleRef}
          type="button"
          aria-label={t('drag', { name })}
          className="flex h-10 w-6 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden className="size-4" />
        </button>
        <span
          aria-hidden
          className="w-6 text-center font-heading text-display-sm tabular-nums leading-none"
        >
          {index + 1}
        </span>
        <span className="sr-only">{t('position', { position: index + 1 })}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate font-medium text-title-sm">{name}</h3>
          {active && <Badge>{t('active')}</Badge>}
        </div>
        <p className="truncate text-muted-foreground text-sm">{account.email}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {account.subscriptionType && (
            <Badge variant="secondary" className="border-border capitalize">
              {account.subscriptionType}
            </Badge>
          )}
          <StatusChip status={account.status} />
        </div>
        {usage?.error && (
          <p className="text-destructive text-xs">{t('pollError', { message: usage.error })}</p>
        )}
      </div>

      <div className="col-span-2 grid grid-cols-2 gap-4 lg:col-span-2 lg:gap-6">
        <UsageBar
          label={t('fiveHour')}
          longLabel={t('fiveHourLong')}
          window={usage?.fiveHour ?? null}
          threshold={thresholds.fiveHour}
        />
        <UsageBar
          label={t('sevenDay')}
          longLabel={t('sevenDayLong')}
          window={usage?.sevenDay ?? null}
          threshold={thresholds.sevenDay}
        />
      </div>

      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 border-t pt-3 lg:col-span-1 lg:justify-end lg:border-0 lg:pt-0">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPromote}
          onClick={() => onPromote(account.id)}
          aria-label={`${t('useNow')}: ${name}`}
        >
          <ZapIcon data-icon="inline-start" />
          {t('useNow')}
        </Button>
        <div className="flex items-center gap-1">
          <Switch
            checked={account.enabled}
            onCheckedChange={(enabled) => onEnabledChange(account.id, enabled)}
            aria-label={t('enable', { name })}
            className="mx-2"
          />
          <Button
            id={`move-up-${account.id}`}
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(account.id, -1)}
            aria-label={t('moveUp', { name })}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            id={`move-down-${account.id}`}
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            onClick={() => onMove(account.id, 1)}
            aria-label={t('moveDown', { name })}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link to="/accounts/$id/remove" params={{ id: account.id }} />}
            aria-label={t('remove', { name })}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </li>
  )
}

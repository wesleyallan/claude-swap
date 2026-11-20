import { Link } from '@tanstack/react-router'
import { AlertTriangleIcon, ChartLineIcon, PlusIcon, UserPlusIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslations } from 'use-intl'
import { Alert, AlertDescription, AlertTitle } from '@/web/components/ui/alert'
import { Button } from '@/web/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/web/components/ui/empty'
import { Skeleton } from '@/web/components/ui/skeleton'
import type { Dashboard as DashboardData } from '@/web/lib/api'
import { useDashboard } from '@/web/lib/query'
import { AccountList } from './account-list'
import { lastTickError } from './model'
import { StatTiles } from './stat-tiles'

const UsageChart = lazy(() => import('./usage-chart'))

function ChartCard({ data }: { data: DashboardData }) {
  const t = useTranslations('chart')
  const empty = data.history.length === 0
  return (
    <section
      aria-labelledby="usage-title"
      className="flex flex-col gap-5 rounded-2xl bg-card p-5 sm:p-6"
    >
      <h2 id="usage-title" className="font-heading text-title-lg">
        {t('title')}
      </h2>
      {empty ? (
        <Empty className="border-none py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartLineIcon />
            </EmptyMedia>
            <EmptyDescription>{t('empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Suspense fallback={<ChartSkeleton />}>
          <UsageChart data={data} />
        </Suspense>
      )}
    </section>
  )
}

const ChartSkeleton = () => (
  <div className="grid gap-8 md:grid-cols-2">
    <Skeleton className="h-64" />
    <Skeleton className="h-64" />
  </div>
)

function Banners({ data }: { data: DashboardData }) {
  const t = useTranslations('dashboard')
  const error = lastTickError(data.activity, data.engine)
  return (
    <>
      {data.engine.unknownLogin && (
        <Alert className="border-warning/60">
          <AlertTriangleIcon className="text-warning" />
          <AlertTitle>{t('unknownLoginTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{t('unknownLogin', { email: data.engine.unknownLogin })}</span>
            <Button
              size="sm"
              className="no-underline!"
              nativeButton={false}
              render={<Link to="/accounts/new" />}
            >
              <UserPlusIcon data-icon="inline-start" />
              {t('importAccount')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {error !== null && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t('engineErrorTitle')}</AlertTitle>
          <AlertDescription>{error || t('engineErrorUnknown')}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

function NoAccounts() {
  const t = useTranslations('dashboard')
  return (
    <Empty className="rounded-2xl border border-dashed py-14">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UserPlusIcon />
        </EmptyMedia>
        <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyHint')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button nativeButton={false} render={<Link to="/accounts/new" />}>
          <PlusIcon data-icon="inline-start" />
          {t('emptyCta')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[122px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

/** The one screen: banners, stat tiles, usage chart and the ordered account list. */
export function Dashboard() {
  const t = useTranslations('dashboard')
  const tAccounts = useTranslations('accounts')
  const { data, isPending, isError, refetch, isFetching } = useDashboard()
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-display-md">{t('title')}</h1>
        <p className="max-w-prose text-muted-foreground">{t('intro')}</p>
      </header>
      {isError && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t('loadFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{t('loadFailedHint')}</span>
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {isPending && !isError && <Loading />}
      {data && (
        <>
          <Banners data={data} />
          {data.accounts.length === 0 ? (
            <NoAccounts />
          ) : (
            <>
              <StatTiles data={data} />
              <ChartCard data={data} />
              <section aria-labelledby="accounts-title" className="flex flex-col gap-4">
                <h2 id="accounts-title" className="font-heading text-title-lg">
                  {tAccounts('listLabel')}
                </h2>
                <AccountList
                  accounts={data.accounts}
                  usage={data.usage}
                  activeId={data.engine.unknownLogin ? null : data.activeId}
                  thresholds={data.preferences.thresholds}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { BookOpenIcon, PlusIcon, RefreshCwIcon, SettingsIcon } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { useTranslations } from 'use-intl'
import { Logo } from '@/web/components/logo'
import { Button } from '@/web/components/ui/button'
import { Skeleton } from '@/web/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/web/components/ui/tooltip'
import { useDashboard, useForceCheck } from '@/web/lib/query'
import { EngineStatus } from './engine-status'
import { ThemeToggle } from './theme-toggle'

// Base UI Select + floating-ui stay out of the initial chunk (200 kB gzip budget, T12).
const LocaleSelect = lazy(() =>
  import('./locale-select').then((m) => ({ default: m.LocaleSelect })),
)

/** Icon-only link to a modal route; the tooltip shows the same text as its accessible name. */
function IconLink({
  to,
  label,
  icon,
}: {
  to: '/docs' | '/settings'
  label: string
  icon: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            nativeButton={false}
            render={<Link to={to} />}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Runs a check now instead of waiting for the poll interval, which then starts over. */
function ForceCheckButton() {
  const t = useTranslations('header')
  const forceCheck = useForceCheck()
  const { data } = useDashboard()
  const label = t('forceCheck')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-busy={forceCheck.isPending}
            disabled={!data || forceCheck.isPending}
            onClick={() => forceCheck.mutate()}
          />
        }
      >
        <RefreshCwIcon className={cn(forceCheck.isPending && 'motion-safe:animate-spin')} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Browser tab: "<active account> - Claude Swap", or just the app name. */
function useDocumentTitle(app: string) {
  const { data } = useDashboard()
  const active = data?.engine.unknownLogin
    ? undefined
    : data?.accounts.find((account) => account.id === data.activeId)?.label
  useEffect(() => {
    document.title = active ? `${active} - ${app}` : app
  }, [active, app])
}

export function Header() {
  const t = useTranslations()
  useDocumentTitle(t('app.name'))
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-md font-heading text-title-lg tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Logo className="size-8" />
          <span className="max-[400px]:sr-only">{t('app.name')}</span>
        </Link>
        <EngineStatus />
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button nativeButton={false} render={<Link to="/accounts/new" />}>
            <PlusIcon data-icon="inline-start" />
            <span className="max-md:sr-only">{t('header.addAccount')}</span>
          </Button>
          <ForceCheckButton />
          <IconLink to="/docs" label={t('header.docs')} icon={<BookOpenIcon />} />
          <IconLink to="/settings" label={t('header.settings')} icon={<SettingsIcon />} />
          <Suspense fallback={<Skeleton className="h-10 w-16 rounded-lg sm:w-32" />}>
            <LocaleSelect />
          </Suspense>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

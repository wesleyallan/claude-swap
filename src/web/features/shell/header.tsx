import { Link } from '@tanstack/react-router'
import { PlusIcon, SettingsIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslations } from 'use-intl'
import { Logo } from '@/web/components/logo'
import { Button } from '@/web/components/ui/button'
import { Skeleton } from '@/web/components/ui/skeleton'
import { EngineStatus } from './engine-status'
import { ThemeToggle } from './theme-toggle'

// Base UI Select + floating-ui stay out of the initial chunk (200 kB gzip budget, T12).
const LocaleSelect = lazy(() =>
  import('./locale-select').then((m) => ({ default: m.LocaleSelect })),
)

export function Header() {
  const t = useTranslations()
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md font-heading text-title-lg tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Logo className="size-6 text-brand" />
          <span className="max-[400px]:sr-only">{t('app.name')}</span>
        </Link>
        <EngineStatus />
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button nativeButton={false} render={<Link to="/accounts/new" />}>
            <PlusIcon data-icon="inline-start" />
            <span className="max-md:sr-only">{t('header.addAccount')}</span>
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link to="/settings" />}>
            <SettingsIcon data-icon="inline-start" />
            <span className="max-md:sr-only">{t('header.settings')}</span>
          </Button>
          <Suspense fallback={<Skeleton className="h-10 w-16 rounded-lg sm:w-32" />}>
            <LocaleSelect />
          </Suspense>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

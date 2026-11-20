import { Link } from '@tanstack/react-router'
import { PlusIcon, SettingsIcon } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { Logo } from '@/web/components/logo'
import { Button } from '@/web/components/ui/button'
import { EngineStatus } from './engine-status'
import { LocaleSelect } from './locale-select'
import { ThemeToggle } from './theme-toggle'

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
          <LocaleSelect />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

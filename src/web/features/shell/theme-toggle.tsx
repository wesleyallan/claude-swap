import { MoonIcon, SunIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '@/web/components/ui/button'
import { usePreferences, useUpdatePreferences } from '@/web/lib/query'

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')
const subscribe = (cb: () => void) => {
  const mq = darkQuery()
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Light/dark switch; `system` resolves through the OS and is only picked in Settings. */
export function ThemeToggle() {
  const t = useTranslations('header')
  const { theme } = usePreferences()
  const systemDark = useSyncExternalStore(subscribe, () => darkQuery().matches)
  const update = useUpdatePreferences()
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? t('switchToLight') : t('switchToDark')}
      onClick={() => update.mutate({ theme: dark ? 'light' : 'dark' })}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

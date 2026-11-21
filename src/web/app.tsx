import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { IntlProvider, useTranslations } from 'use-intl'
import { Toaster } from './components/ui/toast'
import { TooltipProvider } from './components/ui/tooltip'
import { messages } from './i18n'
import { usePreferences } from './lib/query'

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Applies theme + locale to <html> and the i18n context (optimistic: follows the query cache). */
function PreferencesScope({ children }: { children: ReactNode }) {
  const { theme, locale } = usePreferences()
  useEffect(() => {
    const html = document.documentElement
    html.lang = locale
    html.classList.remove('light', 'dark')
    if (theme !== 'system') html.classList.add(theme)
  }, [theme, locale])
  return (
    <IntlProvider locale={locale} messages={messages[locale]} timeZone={timeZone}>
      <Toasts>{children}</Toasts>
    </IntlProvider>
  )
}

function Toasts({ children }: { children: ReactNode }) {
  return <Toaster closeLabel={useTranslations('modal')('close')}>{children}</Toaster>
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      {/* One provider: tooltips open fast and, once one is open, its neighbours open instantly. */}
      <TooltipProvider delay={150}>
        <PreferencesScope>{children}</PreferencesScope>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

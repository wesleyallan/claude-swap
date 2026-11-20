import type { Locale } from '@/web/lib/api'
import en from './messages/en.json'
import es from './messages/es.json'
import ptBR from './messages/pt-BR.json'

export const messages = { en, es, 'pt-BR': ptBR } satisfies Record<Locale, typeof en>
export const locales = Object.keys(messages) as Locale[]

declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof en
  }
}

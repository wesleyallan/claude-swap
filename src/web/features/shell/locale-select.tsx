import { LanguagesIcon } from 'lucide-react'
import { useTranslations } from 'use-intl'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/web/components/ui/select'
import { locales } from '@/web/i18n'
import type { Locale } from '@/web/lib/api'
import { usePreferences, useUpdatePreferences } from '@/web/lib/query'

export function LocaleSelect() {
  const t = useTranslations()
  const { locale } = usePreferences()
  const update = useUpdatePreferences()
  const items = locales.map((value) => ({ value, label: t(`locales.${value}`) }))
  return (
    <Select
      items={items}
      value={locale}
      onValueChange={(value: Locale | null) => value && update.mutate({ locale: value })}
    >
      <SelectTrigger aria-label={t('header.language')}>
        <LanguagesIcon aria-hidden />
        <SelectValue className="max-sm:sr-only" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end" className="w-auto">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} lang={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

import { useNavigate } from '@tanstack/react-router'
import { SettingsIcon } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { RouteModal } from '@/web/components/route-modal'
import { Button } from '@/web/components/ui/button'
import { DialogClose, DialogFooter } from '@/web/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/web/components/ui/field'
import { Input } from '@/web/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/web/components/ui/select'
import { Skeleton } from '@/web/components/ui/skeleton'
import { Switch } from '@/web/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/web/components/ui/toggle-group'
import { locales } from '@/web/i18n'
import type { Locale, Preferences, Theme } from '@/web/lib/api'
import { useDashboard, useUpdatePreferences } from '@/web/lib/query'
import { parseSettings, type SettingsErrors, type SettingsForm, toForm } from './settings-form'

const themes: Theme[] = ['light', 'dark', 'system']
type NumberField = keyof SettingsErrors

export function SettingsModal() {
  const t = useTranslations('modal')
  const { data } = useDashboard()
  return (
    <RouteModal title={t('settingsTitle')} icon={<SettingsIcon />}>
      {data ? (
        <SettingsFormView preferences={data.preferences} />
      ) : (
        <Skeleton aria-busy className="h-96" />
      )}
    </RouteModal>
  )
}

function SettingsFormView({ preferences }: { preferences: Preferences }) {
  const t = useTranslations()
  const navigate = useNavigate()
  const update = useUpdatePreferences()
  const [form, setForm] = useState<SettingsForm>(() => toForm(preferences))
  const [errors, setErrors] = useState<SettingsErrors>({})
  const id = useId()
  const set = (patch: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...patch }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const result = parseSettings(preferences, form)
    if (!result.ok) {
      setErrors(result.errors)
      // Move focus to the first invalid field so keyboard and screen reader users land on it.
      const first = (['fiveHour', 'sevenDay', 'pollIntervalSec'] as const).find(
        (k) => result.errors[k],
      )
      document.getElementById(`${id}-${first}`)?.focus()
      return
    }
    // Optimistic: the dashboard cache updates at once; a failure rolls back with a toast.
    update.mutate(result.preferences)
    navigate({ to: '/' })
  }

  /** `hintId` lets two fields share one visible hint. */
  const numberField = (key: NumberField, label: string, error: string, hintId: string) => (
    <Field data-invalid={errors[key]}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        step={1}
        value={form[key]}
        aria-invalid={errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}-error` : hintId}
        onChange={(e) => {
          set({ [key]: e.target.value })
          setErrors(({ [key]: _, ...rest }) => rest)
        }}
      />
      {errors[key] && <FieldError id={`${id}-${key}-error`}>{error}</FieldError>}
    </Field>
  )

  const localeItems = locales.map((value) => ({ value, label: t(`locales.${value}`) }))
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup className="gap-6">
        <FieldSet>
          <FieldLegend>{t('settings.appearance')}</FieldLegend>
          <Field>
            <FieldLabel id={`${id}-theme`}>{t('settings.theme')}</FieldLabel>
            <ToggleGroup
              aria-labelledby={`${id}-theme`}
              variant="outline"
              value={[form.theme]}
              onValueChange={([theme]) => theme && set({ theme: theme as Theme })}
            >
              {themes.map((theme) => (
                <ToggleGroupItem key={theme} value={theme}>
                  {t(`settings.themes.${theme}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel id={`${id}-locale`}>{t('settings.language')}</FieldLabel>
            <Select
              items={localeItems}
              value={form.locale}
              onValueChange={(locale: Locale | null) => locale && set({ locale })}
            >
              <SelectTrigger aria-labelledby={`${id}-locale`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {localeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} lang={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldSet>
        <FieldSet>
          <FieldLegend>{t('settings.rotation')}</FieldLegend>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-auto`}>{t('settings.autoRotate')}</FieldLabel>
              <FieldDescription id={`${id}-auto-desc`}>
                {t('settings.autoRotateHint')}
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-auto`}
              aria-describedby={`${id}-auto-desc`}
              checked={form.autoRotate}
              onCheckedChange={(autoRotate) => set({ autoRotate })}
            />
          </Field>
          <div className="flex flex-col gap-3">
            <div className="grid gap-6 sm:grid-cols-2">
              {numberField(
                'fiveHour',
                t('settings.fiveHour'),
                t('settings.thresholdError'),
                `${id}-threshold-hint`,
              )}
              {numberField(
                'sevenDay',
                t('settings.sevenDay'),
                t('settings.thresholdError'),
                `${id}-threshold-hint`,
              )}
            </div>
            <FieldDescription id={`${id}-threshold-hint`}>
              {t('settings.thresholdHint')}
            </FieldDescription>
          </div>
          <div className="flex flex-col gap-3">
            {numberField(
              'pollIntervalSec',
              t('settings.pollInterval'),
              t('settings.pollIntervalError'),
              `${id}-poll-hint`,
            )}
            <FieldDescription id={`${id}-poll-hint`}>
              {t('settings.pollIntervalHint')}
            </FieldDescription>
          </div>
        </FieldSet>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('modal.cancel')}</DialogClose>
        <Button type="submit">{t('settings.save')}</Button>
      </DialogFooter>
    </form>
  )
}

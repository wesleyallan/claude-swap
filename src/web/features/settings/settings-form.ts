import * as z from 'zod'
import type { Preferences } from '@/web/lib/api'

/** What the Settings form edits: number fields stay strings until they are parsed. */
export interface SettingsForm {
  theme: Preferences['theme']
  locale: Preferences['locale']
  autoRotate: boolean
  fiveHour: string
  sevenDay: string
  pollIntervalSec: string
}

export type SettingsErrors = Partial<Record<'fiveHour' | 'sevenDay' | 'pollIntervalSec', true>>

// Narrower than the API (any 0–100 %, 10–86 400 s): below 50 % or 60 s is never what anyone wants.
const threshold = z.coerce.number().int().min(50).max(100)
const bounded = {
  fiveHour: threshold,
  sevenDay: threshold,
  pollIntervalSec: z.coerce.number().int().min(60).max(3600),
}
const base = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.enum(['en', 'es', 'pt-BR']),
  autoRotate: z.boolean(),
})

export const toForm = (preferences: Preferences): SettingsForm => ({
  theme: preferences.theme,
  locale: preferences.locale,
  autoRotate: preferences.autoRotate,
  fiveHour: String(preferences.thresholds.fiveHour),
  sevenDay: String(preferences.thresholds.sevenDay),
  pollIntervalSec: String(preferences.pollIntervalSec),
})

/**
 * Validates the form against the `saved` preferences; on failure flags each bad field (the UI owns
 * the translated messages). An untouched number keeps its stored value even outside the UI bounds,
 * so a value set through the API never blocks saving the other fields.
 */
export function parseSettings(
  saved: Preferences,
  form: SettingsForm,
): { ok: true; preferences: Preferences } | { ok: false; errors: SettingsErrors } {
  const savedForm = toForm(saved)
  const numberSchema = (field: keyof SettingsErrors) =>
    form[field].trim() === savedForm[field] ? z.coerce.number() : bounded[field]
  const result = base
    .extend({
      fiveHour: numberSchema('fiveHour'),
      sevenDay: numberSchema('sevenDay'),
      pollIntervalSec: numberSchema('pollIntervalSec'),
    })
    .safeParse(form)
  if (!result.success) {
    const errors: SettingsErrors = {}
    for (const issue of result.error.issues) errors[issue.path[0] as keyof SettingsErrors] = true
    return { ok: false, errors }
  }
  const { fiveHour, sevenDay, ...rest } = result.data
  return { ok: true, preferences: { ...rest, thresholds: { fiveHour, sevenDay } } }
}

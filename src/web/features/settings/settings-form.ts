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
const schema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.enum(['en', 'es', 'pt-BR']),
  autoRotate: z.boolean(),
  fiveHour: threshold,
  sevenDay: threshold,
  pollIntervalSec: z.coerce.number().int().min(60).max(3600),
})

export const toForm = (p: Preferences): SettingsForm => ({
  theme: p.theme,
  locale: p.locale,
  autoRotate: p.autoRotate,
  fiveHour: String(p.thresholds.fiveHour),
  sevenDay: String(p.thresholds.sevenDay),
  pollIntervalSec: String(p.pollIntervalSec),
})

/** Validates the form; on failure flags each bad field (the UI owns the translated messages). */
export function parseSettings(
  form: SettingsForm,
): { ok: true; preferences: Preferences } | { ok: false; errors: SettingsErrors } {
  const r = schema.safeParse(form)
  if (!r.success) {
    const errors: SettingsErrors = {}
    for (const issue of r.error.issues) errors[issue.path[0] as keyof SettingsErrors] = true
    return { ok: false, errors }
  }
  const { fiveHour, sevenDay, ...rest } = r.data
  return { ok: true, preferences: { ...rest, thresholds: { fiveHour, sevenDay } } }
}

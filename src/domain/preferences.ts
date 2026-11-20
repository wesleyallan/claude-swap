export type Theme = 'light' | 'dark' | 'system'
export type Locale = 'en' | 'es' | 'pt-BR'

/** Utilization (0–100) at or above which a window counts as exhausted. */
export interface Thresholds {
  readonly fiveHour: number
  readonly sevenDay: number
}

export interface Preferences {
  readonly theme: Theme
  readonly locale: Locale
  readonly autoRotate: boolean
  readonly thresholds: Thresholds
  readonly pollIntervalSec: number
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  locale: 'en',
  autoRotate: true,
  thresholds: { fiveHour: 95, sevenDay: 98 },
  pollIntervalSec: 180,
}

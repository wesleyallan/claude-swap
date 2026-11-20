import { describe, expect, it } from 'vitest'
import { parseSettings, type SettingsForm, toForm } from './settings-form'

const prefs = {
  theme: 'system',
  locale: 'es',
  autoRotate: false,
  thresholds: { fiveHour: 95, sevenDay: 98 },
  pollIntervalSec: 180,
} as const
const form = (patch: Partial<SettingsForm> = {}): SettingsForm => ({ ...toForm(prefs), ...patch })

describe('parseSettings', () => {
  it('round-trips preferences through the form', () => {
    expect(toForm(prefs)).toMatchObject({ fiveHour: '95', sevenDay: '98', pollIntervalSec: '180' })
    expect(parseSettings(prefs, form())).toEqual({ ok: true, preferences: prefs })
  })

  it('accepts the bounds: thresholds 50–100, poll 60–3600 s', () => {
    const r = parseSettings(
      prefs,
      form({ fiveHour: '50', sevenDay: ' 100 ', pollIntervalSec: '3600' }),
    )
    expect(r).toMatchObject({
      ok: true,
      preferences: { thresholds: { fiveHour: 50, sevenDay: 100 } },
    })
    expect(parseSettings(prefs, form({ pollIntervalSec: '60' })).ok).toBe(true)
  })

  it.each([
    ['fiveHour', '49'],
    ['fiveHour', '101'],
    ['sevenDay', ''],
    ['sevenDay', '97.5'],
    ['pollIntervalSec', '59'],
    ['pollIntervalSec', '3601'],
    ['pollIntervalSec', 'abc'],
  ] as const)('flags %s = %j', (field, value) => {
    expect(parseSettings(prefs, form({ [field]: value }))).toEqual({
      ok: false,
      errors: { [field]: true },
    })
  })

  it('reports every invalid field at once', () => {
    expect(parseSettings(prefs, form({ fiveHour: '0', pollIntervalSec: '1' }))).toEqual({
      ok: false,
      errors: { fiveHour: true, pollIntervalSec: true },
    })
  })

  it('keeps an untouched stored value outside the UI bounds (the API allows wider ones)', () => {
    const stored = { ...prefs, thresholds: { fiveHour: 40, sevenDay: 98 }, pollIntervalSec: 30 }
    expect(parseSettings(stored, { ...toForm(stored), theme: 'dark' })).toEqual({
      ok: true,
      preferences: { ...stored, theme: 'dark' },
    })
    expect(parseSettings(stored, { ...toForm(stored), pollIntervalSec: '31' })).toEqual({
      ok: false,
      errors: { pollIntervalSec: true },
    })
  })
})

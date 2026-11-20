import { describe, expect, it } from 'vitest'
import { migrate } from './migrate'

// Fake history: v0 had a flat `theme`, v1 nests it under `preferences`.
const migrations = {
  0: (d: Record<string, unknown>) => ({ preferences: { theme: d.theme } }),
}

describe('migrate', () => {
  it('upgrades a v0 file (no version field) to v1', () => {
    expect(migrate({ theme: 'dark' }, 1, migrations)).toEqual({
      version: 1,
      preferences: { theme: 'dark' },
    })
  })

  it('leaves a current file untouched', () => {
    const data = { version: 1, preferences: {} }
    expect(migrate(data, 1, migrations)).toEqual(data)
  })

  it('chains several steps', () => {
    const steps = {
      0: (d: Record<string, unknown>) => ({ ...d, a: 1 }),
      1: (d: Record<string, unknown>) => ({ ...d, b: 2 }),
    }
    expect(migrate({}, 2, steps)).toEqual({ version: 2, a: 1, b: 2 })
  })

  it.each([
    ['a non-object', [1]],
    ['a newer version', { version: 2 }],
    ['a non-integer version', { version: '1' }],
    ['a missing step', { version: 0 }],
  ])('rejects %s', (_, raw) => {
    expect(() => migrate(raw, 1, {})).toThrow()
  })
})

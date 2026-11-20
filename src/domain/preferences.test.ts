import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from './preferences'

describe('DEFAULT_PREFERENCES', () => {
  it('matches architecture §5 defaults', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      theme: 'system',
      locale: 'en',
      autoRotate: true,
      thresholds: { fiveHour: 95, sevenDay: 98 },
      pollIntervalSec: 180,
    })
  })
})

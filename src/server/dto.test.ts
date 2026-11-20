import { describe, expect, it } from 'vitest'
import { fakeAccount } from '@/application/testing/fakes'
import type { Dashboard } from '@/application/use-cases'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import { toAccountDto, toDashboardDto } from './dto'

const FORBIDDEN = /token|secret|oauth|credential/i

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out)
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      keysDeep(x, out)
    }
  return out
}

const t = new Date('2026-11-19T12:00:00.000Z')
// A dashboard deliberately polluted with secret-looking keys, as if a future field leaked them.
const dashboard: Dashboard = {
  preferences: DEFAULT_PREFERENCES,
  accounts: [
    {
      ...fakeAccount('a', {
        oauthAccount: { accountUuid: 'a', emailAddress: 'a@x', accessToken: 'x' },
      }),
      ...({ refreshToken: 'leak' } as object),
    },
  ],
  usage: {
    a: { fiveHour: { utilization: 50, resetsAt: t }, sevenDay: null, fetchedAt: t, error: 'e' },
  },
  history: [{ t, accountId: 'a', fiveHour: 50, sevenDay: null }],
  activity: [{ t, type: 'swap', from: null, to: 'a', reason: 'manual' }],
  statuses: { a: 'ok' },
  activeId: 'a',
  engine: { running: true, lastTickAt: t, nextTickAt: null, unknownLogin: 'z@x' },
}

describe('dto', () => {
  it('contains no token, secret or oauth field at any depth', () => {
    const json = JSON.parse(JSON.stringify(toDashboardDto(dashboard)))
    expect(keysDeep(json).filter((k) => FORBIDDEN.test(k))).toEqual([])
    expect(JSON.stringify(json)).not.toContain('leak')
  })

  it('maps dates to ISO strings and keeps what the UI needs', () => {
    const dto = toDashboardDto(dashboard)
    expect(dto.accounts[0]).toEqual({
      id: 'a',
      label: 'A',
      email: 'a@example.test',
      organizationName: null,
      subscriptionType: 'max',
      enabled: true,
      needsReauth: false,
      addedAt: '2026-11-01T00:00:00.000Z',
      status: 'ok',
    })
    expect(dto.usage.a).toEqual({
      fiveHour: { utilization: 50, resetsAt: t.toISOString() },
      sevenDay: null,
      fetchedAt: t.toISOString(),
      error: 'e',
    })
    expect(dto.history[0]?.t).toBe(t.toISOString())
    expect(dto.activity[0]).toEqual({
      t: t.toISOString(),
      type: 'swap',
      from: null,
      to: 'a',
      reason: 'manual',
    })
    expect(dto.engine).toEqual({
      running: true,
      lastTickAt: t.toISOString(),
      nextTickAt: null,
      unknownLogin: 'z@x',
    })
    expect(dto.activeId).toBe('a')
  })

  it('maps a single account', () => {
    expect(Object.keys(toAccountDto(fakeAccount('b')))).not.toContain('oauthAccount')
  })
})

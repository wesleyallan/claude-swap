import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig, AppState, HistoryPoint } from '@/application/ports'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import {
  ACTIVITY_CAP,
  compactHistory,
  HISTORY_CAP,
  JsonConfigRepository,
  JsonSecretsRepository,
  JsonStateRepository,
} from './repositories'

const now = new Date('2026-11-19T12:00:00.000Z')
const clock = { now: () => now }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const MIN = 60_000
const HOUR = 60 * MIN
const ago = (ms: number) => new Date(now.getTime() - ms)

let dir: string
const deps = (name: string) => ({ path: join(dir, name), logger, clock })
const json = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-repo-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const account = (id: string) => ({
  id,
  label: id.toUpperCase(),
  email: `${id}@example.test`,
  organizationName: null,
  subscriptionType: 'max',
  enabled: true,
  needsReauth: false,
  addedAt: new Date('2026-11-01T00:00:00.000Z'),
})

describe('JsonConfigRepository', () => {
  it('defaults to default preferences and no accounts', async () => {
    expect(await new JsonConfigRepository(deps('config.json')).load()).toEqual({
      preferences: DEFAULT_PREFERENCES,
      accounts: [],
    })
  })

  it('round-trips, keeping account order, as versioned JSON 0600', async () => {
    const repo = new JsonConfigRepository(deps('config.json'))
    const config: AppConfig = {
      preferences: { ...DEFAULT_PREFERENCES, theme: 'dark', locale: 'pt-BR' },
      accounts: [account('b'), account('a'), account('c')],
    }
    await repo.save(config)
    expect(await repo.load()).toEqual(config)
    const raw = await json('config.json')
    expect(raw.version).toBe(1)
    expect(raw.accounts[0].addedAt).toBe('2026-11-01T00:00:00.000Z')
    expect((await stat(join(dir, 'config.json'))).mode & 0o777).toBe(0o600)
  })

  it('fills missing preference keys and needsReauth from defaults', async () => {
    const { needsReauth: _, ...legacy } = account('a')
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        preferences: { theme: 'light' },
        accounts: [{ ...legacy, addedAt: legacy.addedAt.toISOString() }],
      }),
    )
    const config = await new JsonConfigRepository(deps('config.json')).load()
    expect(config.preferences).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light' })
    expect(config.accounts[0]?.needsReauth).toBe(false)
  })

  it('treats duplicate account ids as corrupt (backup + default)', async () => {
    const a = { ...account('a'), addedAt: '2026-11-01T00:00:00.000Z' }
    await writeFile(join(dir, 'config.json'), JSON.stringify({ version: 1, accounts: [a, a] }))
    expect((await new JsonConfigRepository(deps('config.json')).load()).accounts).toEqual([])
    expect((await readdir(dir)).some((f) => f.startsWith('config.json.corrupt-'))).toBe(true)
  })
})

describe('JsonSecretsRepository', () => {
  const tokens = (n: number) => ({
    accessToken: `fake-access-${n}`,
    refreshToken: `fake-refresh-${n}`,
    expiresAt: 1_700_000_000_000 + n,
    scopes: ['user:inference'],
    rateLimitTier: 'fake-tier',
  })

  it('stores tokens per account in a 0600 file, keeping unknown keys', async () => {
    const repo = new JsonSecretsRepository(deps('secrets.json'))
    expect(await repo.get('a')).toBeNull()
    await repo.set('a', tokens(1))
    expect(await repo.get('a')).toEqual(tokens(1))
    expect((await stat(join(dir, 'secrets.json'))).mode & 0o777).toBe(0o600)
    expect(await json('secrets.json')).toEqual({ version: 1, tokens: { a: tokens(1) } })
  })

  it('serializes concurrent sets and deletes', async () => {
    const repo = new JsonSecretsRepository(deps('secrets.json'))
    await Promise.all(['a', 'b', 'c', 'd'].map((id, i) => repo.set(id, tokens(i))))
    await Promise.all([repo.delete('b'), repo.set('e', tokens(9)), repo.delete('missing')])
    expect(Object.keys((await json('secrets.json')).tokens).sort()).toEqual(['a', 'c', 'd', 'e'])
    expect(await repo.get('b')).toBeNull()
  })
})

const point = (t: Date, accountId = 'a', fiveHour = 1): HistoryPoint => ({
  t,
  accountId,
  fiveHour,
  sevenDay: null,
})

describe('compactHistory', () => {
  it('keeps the last 24 h at full resolution', () => {
    const points = [ago(23 * HOUR), ago(10 * MIN), ago(MIN)].map((t) => point(t))
    expect(compactHistory(points, now)).toEqual(points)
  })

  it('drops points older than 7 days', () => {
    const recent = point(ago(HOUR))
    expect(compactHistory([point(ago(7 * 24 * HOUR + MIN)), recent], now)).toEqual([recent])
  })

  it('keeps the last point per account per 15-min bucket after 24 h, in order', () => {
    // 2026-11-17T12:00Z is a bucket boundary
    const base = ago(48 * HOUR)
    const at = (m: number) => new Date(base.getTime() + m * MIN)
    const points = [
      point(at(0), 'a', 1),
      point(at(1), 'b', 1),
      point(at(5), 'a', 2),
      point(at(14), 'b', 2),
      point(at(16), 'a', 3),
    ]
    expect(compactHistory(points, now)).toEqual([points[2], points[3], points[4]])
  })

  it('caps the buffer to the newest points', () => {
    const points = Array.from({ length: HISTORY_CAP + 5 }, (_, i) =>
      point(ago((HISTORY_CAP + 5 - i) * 1000)),
    )
    const out = compactHistory(points, now)
    expect(out).toHaveLength(HISTORY_CAP)
    expect(out[0]).toBe(points[5])
    expect(out.at(-1)).toBe(points.at(-1))
  })
})

describe('JsonStateRepository', () => {
  const empty: AppState = { usage: {}, history: [], activity: [], lastActiveId: null }

  it('round-trips usage snapshots, history and activity with dates', async () => {
    const repo = new JsonStateRepository(deps('state.json'))
    expect(await repo.load()).toEqual(empty)
    const state: AppState = {
      usage: {
        a: {
          fiveHour: { utilization: 42, resetsAt: new Date('2026-11-19T14:00:00.000Z') },
          sevenDay: null,
          fetchedAt: ago(MIN),
        },
        b: { fiveHour: null, sevenDay: null, fetchedAt: ago(MIN), error: 'http 500' },
      },
      history: [point(ago(MIN))],
      activity: [
        { t: ago(2 * MIN), type: 'account-added', accountId: 'a' },
        { t: ago(MIN), type: 'swap', from: 'b', to: 'a', reason: 'auto-reset' },
      ],
      lastActiveId: 'a',
    }
    await repo.save(state)
    expect(await repo.load()).toEqual(state)
  })

  it('compacts history and keeps the last 200 activity entries on save', async () => {
    const repo = new JsonStateRepository(deps('state.json'))
    const activity = Array.from({ length: ACTIVITY_CAP + 3 }, (_, i) => ({
      t: ago((ACTIVITY_CAP + 3 - i) * MIN),
      type: 'error' as const,
      message: `e${i}`,
    }))
    await repo.save({ ...empty, history: [point(ago(8 * 24 * HOUR))], activity })
    const loaded = await repo.load()
    expect(loaded.history).toEqual([])
    expect(loaded.activity).toHaveLength(ACTIVITY_CAP)
    expect(loaded.activity[0]).toEqual(activity[3])
  })
})

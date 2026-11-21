import { describe, expect, it } from 'vitest'
import { AccountNotFoundError, InvalidOrderError } from '@/domain/errors'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import {
  FakeClaudeCodeSession,
  FakeClock,
  FakeEngine,
  fakeAccount,
  fakeTokens,
  MemoryConfigRepository,
  MemorySecretsRepository,
  MemoryStateRepository,
  SimpleMutex,
} from '../testing/fakes'
import {
  getCurrentLogin,
  getDashboard,
  getHistory,
  importCurrentLogin,
  NotLoggedInError,
  promoteAccount,
  removeAccount,
  renameAccount,
  reorderAccounts,
  setAccountEnabled,
  updatePreferences,
} from '.'

function setup(ids = ['a', 'b']) {
  const deps = {
    config: new MemoryConfigRepository({
      preferences: DEFAULT_PREFERENCES,
      accounts: ids.map((id) => fakeAccount(id)),
    }),
    secrets: new MemorySecretsRepository(),
    state: new MemoryStateRepository(),
    session: new FakeClaudeCodeSession(),
    clock: new FakeClock(),
    mutex: new SimpleMutex(),
    engine: new FakeEngine(),
  }
  for (const id of ids) deps.secrets.tokens.set(id, fakeTokens(id, 1))
  return deps
}
const order = (d: ReturnType<typeof setup>) => d.config.data.accounts.map((a) => a.id)

describe('importCurrentLogin', () => {
  it('rejects when Claude Code is not logged in', async () => {
    await expect(importCurrentLogin(setup())).rejects.toBeInstanceOf(NotLoggedInError)
  })

  it('adds a new account at the bottom with its tokens and full identity', async () => {
    const d = setup()
    const identity = {
      accountUuid: 'n',
      emailAddress: 'n@example.test',
      displayName: 'New Fake',
      organizationName: 'Fake Org',
      organizationUuid: 'org-n',
    }
    d.session.live = {
      oauth: { ...fakeTokens('n', 5), subscriptionType: 'pro' },
      account: identity,
    }
    const added = await importCurrentLogin(d)
    expect(added).toEqual({
      id: 'n',
      label: 'New Fake',
      email: 'n@example.test',
      organizationName: 'Fake Org',
      subscriptionType: 'pro',
      enabled: true,
      needsReauth: false,
      addedAt: d.clock.now(),
      oauthAccount: identity,
    })
    expect(order(d)).toEqual(['a', 'b', 'n'])
    expect(await d.secrets.get('n')).toEqual(d.session.live.oauth)
    expect(d.state.data.activity).toEqual([
      { t: d.clock.now(), type: 'account-added', accountId: 'n' },
    ])
    expect(d.engine.runs).toEqual([{}])
  })

  it('falls back to the email as label and nulls for missing fields', async () => {
    const d = setup([])
    const { subscriptionType: _, ...bare } = fakeTokens('n', 5)
    d.session.live = { oauth: bare, account: { accountUuid: 'n', emailAddress: 'n@x.test' } }
    expect(await importCurrentLogin(d)).toMatchObject({
      label: 'n@x.test',
      organizationName: null,
      subscriptionType: null,
    })
  })

  it('re-import updates tokens/identity, keeps label/order/enabled, clears needsReauth', async () => {
    const d = setup()
    d.config.data = {
      ...d.config.data,
      accounts: [
        fakeAccount('a', { label: 'Mine', enabled: false, needsReauth: true }),
        fakeAccount('b'),
      ],
    }
    const identity = { ...fakeAccount('a').oauthAccount, emailAddress: 'new@example.test' }
    d.session.live = { oauth: fakeTokens('a2', 9), account: identity }
    await importCurrentLogin(d)
    expect(d.config.data.accounts[0]).toMatchObject({
      label: 'Mine',
      enabled: false,
      needsReauth: false,
      email: 'new@example.test',
      oauthAccount: identity,
    })
    expect(order(d)).toEqual(['a', 'b'])
    expect(await d.secrets.get('a')).toEqual(fakeTokens('a2', 9))
    expect(d.state.data.activity).toEqual([])
  })

  it('applies a trimmed label to a new or re-imported account; blank keeps the default', async () => {
    const d = setup()
    d.session.live = {
      oauth: fakeTokens('n', 5),
      account: { accountUuid: 'n', emailAddress: 'n@x.test' },
    }
    expect(await importCurrentLogin(d, { label: '  Work  ' })).toMatchObject({ label: 'Work' })
    expect(await importCurrentLogin(d, { label: '   ' })).toMatchObject({ label: 'Work' })
    d.session.live = { oauth: fakeTokens('a2', 9), account: fakeAccount('a').oauthAccount }
    expect(await importCurrentLogin(d, { label: 'Personal' })).toMatchObject({ label: 'Personal' })
  })
})

describe('getCurrentLogin', () => {
  it('is null when Claude Code is not logged in', async () => {
    expect(await getCurrentLogin(setup())).toBeNull()
  })

  it('reports the live login and whether it is one of ours', async () => {
    const d = setup()
    d.session.live = {
      oauth: fakeTokens('n', 5),
      account: { accountUuid: 'n', emailAddress: 'n@x.test' },
    }
    expect(await getCurrentLogin(d)).toEqual({ id: 'n', email: 'n@x.test', known: false })
    d.session.live = { oauth: fakeTokens('a', 5), account: fakeAccount('a').oauthAccount }
    expect(await getCurrentLogin(d)).toEqual({
      id: 'a',
      email: fakeAccount('a').oauthAccount.emailAddress,
      known: true,
    })
  })
})

describe('account mutations', () => {
  it('removeAccount drops the account, its tokens and usage; logs it; runs the engine', async () => {
    const d = setup()
    d.state.data = {
      ...d.state.data,
      usage: { a: { fiveHour: null, sevenDay: null, fetchedAt: d.clock.now() } },
    }
    await removeAccount(d, 'a')
    expect(order(d)).toEqual(['b'])
    expect(await d.secrets.get('a')).toBeNull()
    expect(d.state.data.usage).toEqual({})
    expect(d.state.data.activity).toEqual([
      { t: d.clock.now(), type: 'account-removed', accountId: 'a' },
    ])
    expect(d.engine.runs).toEqual([{ manual: true }])
  })

  it('reorderAccounts applies the order (manual run) and rejects a bad list', async () => {
    const d = setup(['a', 'b', 'c'])
    await reorderAccounts(d, ['c', 'a', 'b'])
    expect(order(d)).toEqual(['c', 'a', 'b'])
    expect(d.engine.runs).toEqual([{ manual: true }])
    await expect(reorderAccounts(d, ['a', 'b'])).rejects.toBeInstanceOf(InvalidOrderError)
  })

  it('promoteAccount moves it to the top (manual run)', async () => {
    const d = setup(['a', 'b', 'c'])
    await promoteAccount(d, 'c')
    expect(order(d)).toEqual(['c', 'a', 'b'])
    expect(d.engine.runs).toEqual([{ manual: true }])
  })

  it('setAccountEnabled toggles the flag (manual run)', async () => {
    const d = setup()
    await setAccountEnabled(d, 'b', false)
    expect(d.config.data.accounts[1]?.enabled).toBe(false)
    expect(d.engine.runs).toEqual([{ manual: true }])
  })

  it('reorder, promote and enable wait for the engine run before resolving', async () => {
    const d = setup(['a', 'b', 'c'])
    let release = () => {}
    d.engine.gate = new Promise((r) => {
      release = r
    })
    let done = 0
    const calls = [
      reorderAccounts(d, ['b', 'a', 'c']),
      promoteAccount(d, 'c'),
      setAccountEnabled(d, 'a', false),
    ].map((p) => p.then(() => done++))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(0)
    release()
    await Promise.all(calls)
    expect(done).toBe(3)
  })

  it('renameAccount changes the label without running the engine', async () => {
    const d = setup()
    await renameAccount(d, 'a', 'Work')
    expect(d.config.data.accounts[0]?.label).toBe('Work')
    expect(d.engine.runs).toEqual([])
  })

  it.each([
    ['removeAccount', (d: ReturnType<typeof setup>) => removeAccount(d, 'x')],
    ['promoteAccount', (d: ReturnType<typeof setup>) => promoteAccount(d, 'x')],
    ['setAccountEnabled', (d: ReturnType<typeof setup>) => setAccountEnabled(d, 'x', true)],
    ['renameAccount', (d: ReturnType<typeof setup>) => renameAccount(d, 'x', 'X')],
  ])('%s rejects an unknown id', async (_, run) => {
    const d = setup()
    await expect(run(d)).rejects.toBeInstanceOf(AccountNotFoundError)
    expect(d.engine.runs).toEqual([])
  })
})

describe('updatePreferences', () => {
  it('merges the patch, saves it and runs the engine (which re-reads the interval)', async () => {
    const d = setup()
    const prefs = await updatePreferences(d, { autoRotate: false, pollIntervalSec: 60 })
    expect(prefs).toEqual({ ...DEFAULT_PREFERENCES, autoRotate: false, pollIntervalSec: 60 })
    expect(d.config.data.preferences).toEqual(prefs)
    expect(d.engine.runs).toEqual([{}])
  })
})

describe('getDashboard', () => {
  it('returns accounts, usage, activity, active id and engine status', async () => {
    const d = setup()
    const resetsAt = new Date(d.clock.now().getTime() + 60_000)
    d.state.data = {
      ...d.state.data,
      lastActiveId: 'a',
      usage: {
        a: { fiveHour: { utilization: 100, resetsAt }, sevenDay: null, fetchedAt: d.clock.now() },
      },
    }
    const dash = await getDashboard(d)
    expect(dash).toEqual({
      preferences: DEFAULT_PREFERENCES,
      accounts: d.config.data.accounts,
      statuses: { a: 'exhausted', b: 'unknown' },
      usage: d.state.data.usage,
      activity: [],
      activeId: 'a',
      engine: d.engine.current,
    })
    expect(JSON.stringify(dash)).not.toMatch(/fake-(access|refresh)/)
  })
})

describe('getHistory', () => {
  it('returns the stored history points', async () => {
    const d = setup()
    const point = { t: d.clock.now(), accountId: 'a', fiveHour: 10, sevenDay: 20 }
    d.state.data = { ...d.state.data, history: [point] }
    expect(await getHistory(d)).toEqual([point])
  })
})

import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/web/app'
import type { Dashboard, HistoryPoint } from '@/web/lib/api'
import { createQueryClient } from '@/web/lib/query'
import { createAppRouter } from '@/web/router'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const win = (utilization: number, resetsInMin: number) => ({
  utilization,
  resetsAt: iso(resetsInMin),
})

const account = (id: string, patch: Partial<Dashboard['accounts'][number]> = {}) => ({
  id,
  label: `Account ${id.toUpperCase()}`,
  email: `${id}@example.test`,
  organizationName: null,
  subscriptionType: 'max',
  enabled: true,
  needsReauth: false,
  addedAt: iso(-10_000),
  status: 'ok' as const,
  ...patch,
})

function baseDashboard(): Dashboard {
  return {
    preferences: {
      theme: 'light',
      locale: 'en',
      autoRotate: true,
      thresholds: { fiveHour: 95, sevenDay: 98 },
      pollIntervalSec: 180,
    },
    accounts: [
      account('a'),
      account('b', { status: 'exhausted', subscriptionType: 'pro' }),
      account('c', { status: 'needs-reauth', needsReauth: true }),
      account('d', { status: 'disabled', enabled: false }),
      account('e', { status: 'unknown', subscriptionType: null }),
    ],
    usage: {
      a: { fiveHour: win(42, 90), sevenDay: win(85, 3 * 24 * 60), fetchedAt: iso(-1) },
      b: {
        fiveHour: win(100, 30),
        sevenDay: win(60, 24 * 60),
        fetchedAt: iso(-1),
        error: 'HTTP 429',
      },
    },
    activity: [
      { t: iso(-60), type: 'swap', from: 'b', to: 'a', reason: 'auto-exhausted' },
      { t: iso(-26 * 60), type: 'swap', from: 'a', to: 'b', reason: 'manual' },
    ],
    activeId: 'a',
    engine: { running: true, lastTickAt: iso(-1), nextTickAt: iso(2), unknownLogin: null },
  }
}

let dashboard: Dashboard
let history: HistoryPoint[] = []
let failMutations = false
const requests: { method: string; path: string; body: unknown }[] = []

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost')
  const method = input instanceof Request ? input.method : (init?.method ?? 'GET')
  if (method === 'GET' && url.pathname === '/api/dashboard') return Response.json(dashboard)
  if (method === 'GET' && url.pathname === '/api/history') return Response.json(history)
  requests.push({ method, path: url.pathname, body: init?.body && JSON.parse(String(init.body)) })
  if (failMutations) return Response.json({ error: 'internal' }, { status: 500 })
  const promoted = url.pathname.match(/^\/api\/accounts\/(\w+)\/promote$/)?.[1]
  const ids =
    url.pathname === '/api/accounts/order'
      ? (requests.at(-1)?.body as { ids: string[] } | undefined)?.ids
      : promoted && [
          promoted,
          ...dashboard.accounts.map((a) => a.id).filter((id) => id !== promoted),
        ]
  if (ids) {
    const byId = new Map(dashboard.accounts.map((a) => [a.id, a]))
    dashboard = { ...dashboard, accounts: ids.flatMap((id) => byId.get(id) ?? []) }
  }
  return Response.json({ ok: true }, { status: url.pathname.endsWith('/import') ? 201 : 200 })
})

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  dashboard = baseDashboard()
  history = []
  failMutations = false
  requests.length = 0
  vi.stubGlobal('fetch', fetchMock)
  document.documentElement.className = 'light'
  document.documentElement.lang = 'en'
})
afterEach(() => {
  fetchMock.mockReset() // back to the default implementation
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderApp() {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, refetchInterval: false } })
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
  render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

const list = () => screen.findByRole('list', { name: 'Accounts by priority' })
const rowOf = async (name: string) =>
  (await within(await list()).findByRole('heading', { name })).closest('li') as HTMLElement
const order = async () =>
  within(await list())
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent)

it('shows each row state: active, plan, status, usage bars, countdowns and poll errors', async () => {
  renderApp()
  const a = await rowOf('Account A')
  expect(within(a).getByText('Active')).toBeInTheDocument()
  expect(within(a).getByText('max')).toBeInTheDocument()
  expect(within(a).getByText('OK')).toBeInTheDocument()
  expect(within(a).getByText('Priority 1')).toBeInTheDocument()
  expect(within(a).getByRole('progressbar', { name: '5-hour usage' })).toHaveAttribute(
    'aria-valuenow',
    '42',
  )
  expect(within(a).getByText('42%')).toBeInTheDocument()
  expect(within(a).getByText('resets in 2 hours')).toBeInTheDocument()
  expect(within(a).getByText('85%')).toBeInTheDocument()
  // Use now is pointless on the top account.
  expect(within(a).getByRole('button', { name: 'Use now: Account A' })).toBeDisabled()

  const b = await rowOf('Account B')
  expect(within(b).queryByText('Active')).not.toBeInTheDocument()
  expect(within(b).getByText('Limit reached')).toBeInTheDocument()
  expect(within(b).getByText('Last check failed: HTTP 429')).toBeInTheDocument()
  expect(within(b).getByRole('button', { name: 'Use now: Account B' })).toBeEnabled()

  const c = await rowOf('Account C')
  expect(within(c).getByText('Needs re-login')).toBeInTheDocument()
  expect(within(c).getByRole('button', { name: 'Use now: Account C' })).toBeDisabled()

  const d = await rowOf('Account D')
  expect(within(d).getByText('Disabled')).toBeInTheDocument()
  expect(within(d).getByRole('switch', { name: 'Enable Account D' })).not.toBeChecked()

  const e = await rowOf('Account E')
  expect(within(e).getByText('Unknown')).toBeInTheDocument()
  expect(within(e).getAllByText('No data')).toHaveLength(2)
  expect(within(e).getByRole('button', { name: 'Move Account E down' })).toBeDisabled()
  // Base UI renders link-buttons as <a role="button">.
  expect(within(e).getByRole('button', { name: 'Remove Account E' })).toHaveAttribute(
    'href',
    '/accounts/e/remove',
  )
})

it('shows the stat tiles', async () => {
  renderApp()
  const summary = await screen.findByLabelText('Summary')
  expect(within(summary).getByText('Account A')).toBeInTheDocument()
  expect(within(summary).getByText('in 30 minutes')).toBeInTheDocument() // b's 5h reset
  expect(within(summary).getByText('1 automatic or manual swap')).toBeInTheDocument()
  expect(within(summary).getByText('Automatic')).toBeInTheDocument()
})

it('loads the chart from /api/history, apart from the dashboard', async () => {
  renderApp()
  expect(await screen.findByText(/No usage recorded yet/)).toBeInTheDocument()
  cleanup()
  history = [{ t: iso(-5), accountId: 'a', fiveHour: 40, sevenDay: 70 }]
  renderApp()
  expect(await screen.findByText('5-hour window · last 24 h')).toBeInTheDocument()
  expect(screen.getByText('Latest values: Account A: 40%.')).toBeInTheDocument()
})

it('says so when the history cannot be loaded instead of loading forever', async () => {
  const respond = fetchMock.getMockImplementation()
  if (!respond) throw new Error('fetchMock has no implementation')
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith('/api/history')
      ? Response.json({ error: 'internal' }, { status: 500 })
      : respond(input, init),
  )
  renderApp()
  expect(await screen.findByText("Couldn't load the usage history.")).toBeInTheDocument()
})

it('reorders with the keyboard, optimistically, keeping focus on the arrow', async () => {
  const user = userEvent.setup()
  renderApp()
  const down = within(await rowOf('Account A')).getByRole('button', { name: 'Move Account A down' })
  down.focus()
  await user.keyboard('{Enter}')
  expect(await order()).toEqual(['Account B', 'Account A', 'Account C', 'Account D', 'Account E'])
  await waitFor(() =>
    expect(requests).toEqual([
      { method: 'PUT', path: '/api/accounts/order', body: { ids: ['b', 'a', 'c', 'd', 'e'] } },
    ]),
  )
  expect(screen.getByText('Account A moved to position 2 of 5.')).toBeInTheDocument()
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move Account A down' }),
    ),
  )
})

it('rolls a failed reorder back and says so in a toast', async () => {
  failMutations = true
  const user = userEvent.setup()
  renderApp()
  await user.click(
    within(await rowOf('Account B')).getByRole('button', { name: 'Move Account B up' }),
  )
  expect(await screen.findByText("Couldn't save the change")).toBeInTheDocument()
  expect(await order()).toEqual(['Account A', 'Account B', 'Account C', 'Account D', 'Account E'])
})

it('promotes with Use now and toggles an account', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(
    within(await rowOf('Account B')).getByRole('button', { name: 'Use now: Account B' }),
  )
  expect((await order())[0]).toBe('Account B')
  // B has hit its limit, so the engine will not activate it: A keeps the badge.
  expect(within(await rowOf('Account A')).getByText('Active')).toBeInTheDocument()
  await user.click(screen.getByRole('switch', { name: 'Enable Account D' }))
  await waitFor(() =>
    expect(requests).toEqual([
      { method: 'POST', path: '/api/accounts/b/promote', body: undefined },
      { method: 'PATCH', path: '/api/accounts/d', body: { enabled: true } },
    ]),
  )
})

it('marks a healthy account active as soon as Use now is clicked', async () => {
  dashboard.accounts[1] = account('b')
  const respond = fetchMock.getMockImplementation()
  if (!respond) throw new Error('fetchMock has no implementation')
  // The swap never finishes, so only the optimistic update can show the badge.
  fetchMock.mockImplementation((input, init) =>
    String(input instanceof Request ? input.url : input).endsWith('/promote')
      ? new Promise<Response>(() => {})
      : respond(input, init),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(
    within(await rowOf('Account B')).getByRole('button', { name: 'Use now: Account B' }),
  )
  expect(within(await rowOf('Account B')).getByText('Active')).toBeInTheDocument()
  expect(within(await rowOf('Account A')).queryByText('Active')).not.toBeInTheDocument()
})

it('flags an unknown Claude Code login and links to the import modal', async () => {
  dashboard.engine.unknownLogin = 'new@example.test'
  renderApp()
  expect(await screen.findByText('Swapping is paused')).toBeInTheDocument()
  expect(screen.getByText(/logged in as new@example\.test/)).toBeInTheDocument()
  const summary = screen.getByLabelText('Summary')
  expect(within(summary).getByText('Paused')).toBeInTheDocument()
  expect(within(summary).getByText('Not in your list')).toBeInTheDocument()
  // The last account we activated is no longer what Claude Code uses.
  expect(within(await list()).queryByText('Active')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import account' })).toHaveAttribute(
    'href',
    '/accounts/new',
  )
})

it('shows an error from the last engine tick only', async () => {
  dashboard.activity.push({ t: iso(-1.5), type: 'error', message: 'disk full' })
  renderApp()
  expect(await screen.findByText('The last engine check failed')).toBeInTheDocument()
  expect(screen.getByText('disk full')).toBeInTheDocument()
})

it('offers to add the first account when there are none', async () => {
  dashboard = { ...dashboard, accounts: [], usage: {}, activeId: null }
  renderApp()
  expect(await screen.findByText('No accounts yet')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add your first account' })).toHaveAttribute(
    'href',
    '/accounts/new',
  )
})

it('shows skeletons while loading', async () => {
  fetchMock.mockImplementationOnce(() => new Promise(() => {}))
  renderApp()
  await waitFor(() => expect(document.querySelector('[aria-busy]')).toBeInTheDocument())
})

it('shows an error with retry when the server is down', async () => {
  let fail = true
  fetchMock.mockImplementation(async (input) =>
    fail
      ? Promise.reject(new TypeError('offline'))
      : Response.json(String(input).endsWith('/api/history') ? history : dashboard),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument()
  fail = false
  await act(() => user.click(screen.getByRole('button', { name: 'Try again' })))
  expect(await list()).toBeInTheDocument()
})

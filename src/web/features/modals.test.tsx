import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/web/app'
import type { Dashboard } from '@/web/lib/api'
import { createQueryClient } from '@/web/lib/query'
import { createAppRouter } from '@/web/router'
import devEn from './dev-docs/content/en.md?raw'
import devEs from './dev-docs/content/es.md?raw'
import devPtBR from './dev-docs/content/pt-BR.md?raw'
import en from './docs/content/en.md?raw'
import es from './docs/content/es.md?raw'
import ptBR from './docs/content/pt-BR.md?raw'
import { parseDocs } from './docs/parse-docs'

const account = (id: string) => ({
  id,
  label: `Account ${id.toUpperCase()}`,
  email: `${id}@example.test`,
  organizationName: null,
  subscriptionType: 'max',
  enabled: true,
  needsReauth: false,
  addedAt: '2026-11-01T00:00:00.000Z',
  status: 'ok' as const,
})

let dashboard: Dashboard
let current: { id: string; email: string; known: boolean } | null
const requests: { method: string; path: string; body: unknown }[] = []

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost')
  const method = input instanceof Request ? input.method : (init?.method ?? 'GET')
  if (method === 'GET' && url.pathname === '/api/dashboard') return Response.json(dashboard)
  if (method === 'GET' && url.pathname === '/api/history') return Response.json([])
  if (method === 'GET' && url.pathname === '/api/accounts/current') {
    return Response.json({ login: current })
  }
  const body = init?.body && JSON.parse(String(init.body))
  requests.push({ method, path: url.pathname, body })
  if (url.pathname === '/api/accounts/import') {
    return Response.json(
      { ...account('n'), label: body.label || 'n@example.test' },
      { status: 201 },
    )
  }
  if (method === 'DELETE') {
    dashboard = { ...dashboard, accounts: dashboard.accounts.filter((a) => a.id !== 'b') }
  }
  return Response.json({ ok: true })
})

beforeEach(() => {
  dashboard = {
    preferences: {
      theme: 'light',
      locale: 'en',
      autoRotate: true,
      thresholds: { fiveHour: 95, sevenDay: 98 },
      pollIntervalSec: 180,
    },
    accounts: [account('a'), account('b')],
    usage: {},
    activity: [],
    activeId: 'a',
    engine: { running: true, lastTickAt: null, nextTickAt: null, unknownLogin: null },
  }
  current = { id: 'n', email: 'n@example.test', known: false }
  requests.length = 0
  vi.stubGlobal('fetch', fetchMock)
  document.documentElement.className = 'light'
  document.documentElement.lang = 'en'
})
afterEach(() => {
  fetchMock.mockClear()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, refetchInterval: false } })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

const dialog = (name: string) => screen.findByRole('dialog', { name })
const closed = (router: ReturnType<typeof renderAt>) =>
  waitFor(() => {
    expect(router.state.location.pathname).toBe('/')
    // Not queried by role: toasts are role="dialog" too.
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })

it('opens a modal from its link over the dashboard; Esc closes it and refocuses the link', async () => {
  const user = userEvent.setup()
  const router = renderAt('/')
  const link = await screen.findByRole('button', { name: 'Settings' })
  await user.click(link)
  await dialog('Settings')
  expect(screen.getByRole('heading', { name: 'Accounts', hidden: true })).toBeInTheDocument() // underneath
  await user.keyboard('{Escape}')
  await closed(router)
  await waitFor(() => expect(link).toHaveFocus())
})

it('closes on browser back', async () => {
  const router = renderAt('/')
  await screen.findByRole('heading', { name: 'Accounts' })
  await act(() => router.navigate({ to: '/settings' }))
  await dialog('Settings')
  act(() => router.history.back())
  await closed(router)
})

it('settings: validates inline, then saves every preference and closes', async () => {
  const user = userEvent.setup()
  const router = renderAt('/settings')
  const d = await dialog('Settings')
  const fiveHour = within(d).getByLabelText('5-hour limit (%)')
  const poll = within(d).getByLabelText('Check every (seconds)')
  expect(fiveHour).toHaveValue(95)
  await user.clear(fiveHour)
  await user.type(fiveHour, '40')
  await user.clear(poll)
  await user.type(poll, '30')
  await user.click(within(d).getByRole('button', { name: 'Save settings' }))
  expect(fiveHour).toHaveAttribute('aria-invalid', 'true')
  expect(fiveHour).toHaveFocus()
  expect(fiveHour).toHaveAccessibleDescription('Enter a whole number from 50 to 100.')
  expect(poll).toHaveAccessibleDescription('Enter a whole number from 60 to 3600.')
  expect(requests).toEqual([])

  await user.clear(fiveHour)
  await user.type(fiveHour, '90')
  expect(fiveHour).not.toHaveAttribute('aria-invalid', 'true')
  await user.clear(poll)
  await user.type(poll, '600')
  await user.click(within(d).getByRole('button', { name: 'System' }))
  await user.click(within(d).getByRole('switch', { name: 'Swap automatically' }))
  await user.click(within(d).getByRole('button', { name: 'Save settings' }))
  await closed(router)
  expect(requests).toEqual([
    {
      method: 'PATCH',
      path: '/api/preferences',
      body: {
        theme: 'system',
        locale: 'en',
        autoRotate: false,
        thresholds: { fiveHour: 90, sevenDay: 98 },
        pollIntervalSec: 600,
      },
    },
  ])
})

it('add account: shows the steps and detected login, imports with a label', async () => {
  const user = userEvent.setup()
  const router = renderAt('/accounts/new')
  const d = await dialog('Add account')
  expect(within(d).getByText('/login')).toBeInTheDocument()
  expect(within(d).getByText('Use /login, not /logout')).toBeInTheDocument()
  expect(await within(d).findByText('n@example.test')).toBeInTheDocument()
  await user.type(within(d).getByLabelText('Name (optional)'), 'Work')
  await user.click(within(d).getByRole('button', { name: 'Import current login' }))
  await closed(router)
  expect(requests).toEqual([
    { method: 'POST', path: '/api/accounts/import', body: { label: 'Work' } },
  ])
  expect(await screen.findByText('Work added')).toBeInTheDocument()
})

it('add account: a known login says its tokens get updated', async () => {
  current = { id: 'a', email: 'a@example.test', known: true }
  const user = userEvent.setup()
  renderAt('/accounts/new')
  const d = await dialog('Add account')
  expect(await within(d).findByText(/In your list/)).toBeInTheDocument()
  await user.click(within(d).getByRole('button', { name: 'Import current login' }))
  expect(await screen.findByText('Login updated for n@example.test')).toBeInTheDocument()
})

it('add account: nothing to import while Claude Code is logged out', async () => {
  current = null
  renderAt('/accounts/new')
  const d = await dialog('Add account')
  expect(await within(d).findByText(/isn't logged in/)).toBeInTheDocument()
  expect(within(d).getByRole('button', { name: 'Import current login' })).toBeDisabled()
})

it('remove: warns for the active account', async () => {
  renderAt('/accounts/a/remove')
  const d = await dialog('Remove account')
  expect(await within(d).findByText('Claude Code is using this account')).toBeInTheDocument()
})

it('remove: confirms, deletes and closes', async () => {
  const user = userEvent.setup()
  const router = renderAt('/accounts/b/remove')
  const d = await dialog('Remove account')
  expect(await within(d).findByText(/Account B and its saved login/)).toBeInTheDocument()
  expect(within(d).queryByText('Claude Code is using this account')).not.toBeInTheDocument()
  await user.click(within(d).getByRole('button', { name: 'Remove account' }))
  await closed(router)
  expect(requests).toEqual([{ method: 'DELETE', path: '/api/accounts/b', body: undefined }])
  expect(await screen.findByText('Account B removed')).toBeInTheDocument()
  await waitFor(() => expect(document.getElementById('main')).toHaveFocus())
})

it('remove: an unknown id only offers to close', async () => {
  renderAt('/accounts/zzz/remove')
  const d = await dialog('Remove account')
  expect(await within(d).findByText("This account isn't in your list anymore.")).toBeInTheDocument()
  expect(within(d).queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument()
})

it('docs: lists the sections and shows the one picked', async () => {
  const user = userEvent.setup()
  renderAt('/')
  await user.click(await screen.findByRole('button', { name: 'Documentation' }))
  const d = await dialog('Documentation')
  const nav = within(d).getByRole('navigation', { name: 'Sections' })
  expect(within(d).getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
  await user.click(within(nav).getByRole('button', { name: 'Settings' }))
  expect(within(d).getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

it('docs: shows the icon in the title and opens external links in a new tab', async () => {
  const user = userEvent.setup()
  renderAt('/docs')
  const d = await dialog('Documentation')
  expect(
    within(d).getByRole('heading', { name: 'Documentation' }).querySelector('svg'),
  ).not.toBeNull()
  await user.click(within(d).getByRole('button', { name: 'About me' }))
  for (const link of within(d).getAllByRole('link', { name: 'GitHub' })) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  }
})

it('docs: a code icon next to close opens the developer docs page', async () => {
  const user = userEvent.setup()
  renderAt('/docs')
  const d = await dialog('Documentation')
  await user.click(within(d).getByRole('button', { name: 'Developer documentation' }))
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Developer documentation' }),
  ).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('force check runs the engine now and refetches the dashboard', async () => {
  const user = userEvent.setup()
  renderAt('/')
  const button = await screen.findByRole('button', { name: 'Force check' })
  await waitFor(() => expect(button).toBeEnabled())
  const dashboardFetches = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/dashboard')).length
  const before = dashboardFetches()
  await user.click(button)
  await waitFor(() =>
    expect(requests).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/engine/run' }),
    ),
  )
  await waitFor(() => expect(dashboardFetches()).toBeGreaterThan(before))
})

it('/docs-dev: a full page with a section index, in the UI language', async () => {
  dashboard = { ...dashboard, preferences: { ...dashboard.preferences, locale: 'pt-BR' } }
  renderAt('/docs-dev')
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Documentação para desenvolvedores' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Seções' })
  expect(within(nav).getByRole('link', { name: 'Arquitetura' })).toHaveAttribute(
    'href',
    '#arquitetura',
  )
  expect(screen.getByRole('heading', { level: 2, name: 'Arquitetura' })).toHaveAttribute(
    'id',
    'arquitetura',
  )
})

it('/docs-dev: every locale has the same sections', () => {
  const counts = [devEn, devEs, devPtBR].map((md) => parseDocs(md).length)
  expect(counts[0]).toBeGreaterThan(5)
  expect(new Set(counts).size).toBe(1)
})

it('docs: every locale has the same sections', () => {
  const counts = [en, es, ptBR].map((md) => parseDocs(md).length)
  expect(counts[0]).toBeGreaterThan(3)
  expect(new Set(counts).size).toBe(1)
})

it('names the browser tab after the active account', async () => {
  renderAt('/')
  await waitFor(() => expect(document.title).toBe('Account A - Claude Swap'))
})

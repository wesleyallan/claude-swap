import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/web/app'
import { createQueryClient } from '@/web/lib/query'
import { LocaleSelect } from './locale-select'
import { ThemeToggle } from './theme-toggle'

const initialPreferences = {
  theme: 'light',
  locale: 'en',
  autoRotate: true,
  thresholds: { fiveHour: 95, sevenDay: 98 },
  pollIntervalSec: 180,
}
let preferences = initialPreferences
const dashboard = () => ({
  preferences,
  accounts: [],
  usage: {},
  history: [],
  activity: [],
  activeId: null,
  engine: { running: true, lastTickAt: null, nextTickAt: null, unknownLogin: null },
})

let patchStatus = 200
/** While set, PATCH responses wait for it: lets a test observe the optimistic state. */
let patchGate: Promise<void> | undefined
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const method = input instanceof Request ? input.method : (init?.method ?? 'GET')
  if (url.endsWith('/api/dashboard')) return Response.json(dashboard())
  if (url.endsWith('/api/preferences') && method === 'PATCH') {
    await patchGate
    if (patchStatus !== 200) return Response.json({ error: 'internal' }, { status: patchStatus })
    preferences = { ...preferences, ...JSON.parse(String(init?.body)) }
    return Response.json(preferences)
  }
  return new Response('not found', { status: 404 })
})

beforeEach(() => {
  patchStatus = 200
  patchGate = undefined
  preferences = initialPreferences
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  document.documentElement.className = 'light'
  document.documentElement.lang = 'en'
})
afterEach(() => vi.unstubAllGlobals())

const renderShell = (ui: React.ReactNode) => {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, refetchInterval: false } })
  return render(<AppProviders client={client}>{ui}</AppProviders>)
}

const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init?.body)))

it('switches the theme optimistically and saves it', async () => {
  // The server-rendered class wins until the dashboard loads.
  renderShell(<ThemeToggle />)
  const toggle = await screen.findByRole('button', { name: 'Switch to dark theme' })
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  let release = () => {}
  patchGate = new Promise((r) => {
    release = r
  })
  await userEvent.click(toggle)
  // Applied while the PATCH is still pending.
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  expect(patches()).toEqual([{ theme: 'dark' }])
  release()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)) // refetch after settling
  expect(document.documentElement).toHaveClass('dark')
})

it('rolls the theme back when saving fails', async () => {
  patchStatus = 500
  renderShell(<ThemeToggle />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await userEvent.click(await screen.findByRole('button', { name: 'Switch to dark theme' }))
  await waitFor(() => expect(document.documentElement).toHaveClass('light'))
  expect(document.documentElement).not.toHaveClass('dark')
})

it('starts from the server-rendered dark class before data arrives', () => {
  fetchMock.mockImplementationOnce(() => new Promise(() => {}))
  document.documentElement.className = 'dark'
  renderShell(<ThemeToggle />)
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
})

it('switches the language, translating the UI and <html lang>', async () => {
  renderShell(<LocaleSelect />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await userEvent.click(await screen.findByRole('combobox', { name: 'Language' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Português (Brasil)' }))
  expect(await screen.findByRole('combobox', { name: 'Idioma' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('pt-BR')
  await waitFor(() => expect(patches()).toEqual([{ locale: 'pt-BR' }]))
})

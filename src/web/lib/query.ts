import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { toast } from '@/web/components/ui/toast'
import {
  type Dashboard,
  fetchCurrentLogin,
  fetchDashboard,
  importCurrentLogin,
  type Locale,
  type Preferences,
  patchPreferences,
  promoteAccount,
  putOrder,
  removeAccount,
  setAccountEnabled,
  type Theme,
} from './api'

export const createQueryClient = () =>
  new QueryClient({
    // Polling pauses while the tab is hidden (refetchIntervalInBackground defaults to false).
    defaultOptions: { queries: { refetchInterval: 10_000, retry: 1 } },
  })

const dashboardKey = ['dashboard'] as const

export const useDashboard = () => useQuery({ queryKey: dashboardKey, queryFn: fetchDashboard })

/** Theme and locale as the server rendered them into <html>, used until the dashboard loads. */
function fromDocument(): { theme: Theme; locale: Locale } {
  const html = document.documentElement
  const theme = html.classList.contains('dark')
    ? 'dark'
    : html.classList.contains('light')
      ? 'light'
      : 'system'
  const lang = html.lang
  return { theme, locale: lang === 'es' || lang === 'pt-BR' ? lang : 'en' }
}

export function usePreferences() {
  const { data } = useDashboard()
  return data?.preferences ?? fromDocument()
}

/**
 * A mutation that applies `optimistic` to the cached dashboard at once, rolls it back and shows
 * an error toast when the request fails, and refetches once it settles either way.
 */
function useDashboardMutation<V>(
  mutationFn: (vars: V) => Promise<unknown>,
  optimistic: (d: Dashboard, vars: V) => Dashboard,
) {
  const client = useQueryClient()
  const t = useTranslations('errors')
  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      await client.cancelQueries({ queryKey: dashboardKey })
      const previous = client.getQueryData<Dashboard>(dashboardKey)
      if (previous) client.setQueryData<Dashboard>(dashboardKey, optimistic(previous, vars))
      return { previous }
    },
    onError: (_err, _vars, result) => {
      client.setQueryData(dashboardKey, result?.previous)
      toast.add({ title: t('saveFailed'), description: t('rolledBack'), type: 'error' })
    },
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

/** Accounts in the order of `ids` (ids missing from the cache are ignored). */
const ordered = (d: Dashboard, ids: readonly string[]): Dashboard => ({
  ...d,
  accounts: ids.flatMap((id) => d.accounts.find((a) => a.id === id) ?? []),
})

export const useUpdatePreferences = () =>
  useDashboardMutation(patchPreferences, (d, patch) => ({
    ...d,
    preferences: { ...d.preferences, ...patch } as Preferences,
  }))

export const useReorderAccounts = () => useDashboardMutation(putOrder, ordered)

/** "Use now": moves the account to the top; the engine then makes it active. */
export const usePromoteAccount = () =>
  useDashboardMutation(promoteAccount, (d, id) =>
    ordered(d, [id, ...d.accounts.map((a) => a.id).filter((x) => x !== id)]),
  )

export const useSetAccountEnabled = () =>
  useDashboardMutation(setAccountEnabled, (d, { id, enabled }) => ({
    ...d,
    accounts: d.accounts.map((a) => (a.id === id ? { ...a, enabled } : a)),
  }))

export const useRemoveAccount = () =>
  useDashboardMutation(removeAccount, (d, id) => ({
    ...d,
    accounts: d.accounts.filter((a) => a.id !== id),
  }))

/** Who Claude Code is logged in as; polled fast while the "Add account" modal is open. */
export const useCurrentLogin = () =>
  useQuery({ queryKey: ['current-login'], queryFn: fetchCurrentLogin, refetchInterval: 3000 })

/** Imports the login Claude Code is using right now, with an optional label. */
export function useImportCurrentLogin() {
  const client = useQueryClient()
  const t = useTranslations('errors')
  return useMutation({
    mutationFn: (label: string) => importCurrentLogin(label),
    onError: () => toast.add({ title: t('importFailed'), type: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

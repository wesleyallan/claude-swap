import {
  keepPreviousData,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { toast } from '@/web/components/ui/toast'
import {
  type Dashboard,
  fetchCurrentLogin,
  fetchDashboard,
  fetchHistory,
  importCurrentLogin,
  type Locale,
  type Preferences,
  patchPreferences,
  promoteAccount,
  putOrder,
  removeAccount,
  runEngineNow,
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

/**
 * Usage history for the chart. It only changes when the engine finishes a check, so it is keyed
 * on the dashboard's `lastTickAt` and fetched once per check instead of on every poll.
 */
export function useHistory() {
  const { data } = useDashboard()
  const lastTickAt = data?.engine.lastTickAt
  return useQuery({
    queryKey: ['history', lastTickAt],
    queryFn: fetchHistory,
    enabled: data !== undefined,
    refetchInterval: false,
    placeholderData: keepPreviousData,
  })
}

/** Runs an engine check now; the server restarts the poll countdown from it. */
export function useForceCheck() {
  const client = useQueryClient()
  const t = useTranslations('errors')
  return useMutation({
    mutationFn: runEngineNow,
    onError: () => toast.add({ title: t('checkFailed'), type: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

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
 * A mutation that applies `applyOptimistically` to the cached dashboard at once, rolls it back and shows
 * an error toast when the request fails, and refetches once it settles either way.
 */
function useDashboardMutation<V>(
  mutationFn: (vars: V) => Promise<unknown>,
  applyOptimistically: (dashboard: Dashboard, variables: V) => Dashboard,
) {
  const client = useQueryClient()
  const t = useTranslations('errors')
  return useMutation({
    mutationFn,
    onMutate: async (variables: V) => {
      await client.cancelQueries({ queryKey: dashboardKey })
      const previous = client.getQueryData<Dashboard>(dashboardKey)
      if (previous) {
        client.setQueryData<Dashboard>(dashboardKey, applyOptimistically(previous, variables))
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      client.setQueryData(dashboardKey, context?.previous)
      toast.add({ title: t('saveFailed'), description: t('rolledBack'), type: 'error' })
    },
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

/** Accounts in the order of `ids` (ids missing from the cache are ignored). */
const inOrder = (dashboard: Dashboard, ids: readonly string[]): Dashboard => ({
  ...dashboard,
  accounts: ids.flatMap((id) => dashboard.accounts.find((account) => account.id === id) ?? []),
})

export const useUpdatePreferences = () =>
  useDashboardMutation(patchPreferences, (dashboard, patch) => ({
    ...dashboard,
    preferences: { ...dashboard.preferences, ...patch } as Preferences,
  }))

export const useReorderAccounts = () => useDashboardMutation(putOrder, inOrder)

/**
 * "Use now": moves the account to the top. The request returns after the engine swapped, so a
 * healthy account is shown active at once to hide that wait.
 */
export const usePromoteAccount = () =>
  useDashboardMutation(promoteAccount, (dashboard, id) => {
    const otherIds = dashboard.accounts.map((account) => account.id).filter((other) => other !== id)
    const promoted = inOrder(dashboard, [id, ...otherIds])
    const healthy = dashboard.accounts.find((account) => account.id === id)?.status === 'ok'
    // A paused engine (unknown login) will not swap.
    return healthy && !dashboard.engine.unknownLogin ? { ...promoted, activeId: id } : promoted
  })

export const useSetAccountEnabled = () =>
  useDashboardMutation(setAccountEnabled, (dashboard, { id, enabled }) => ({
    ...dashboard,
    accounts: dashboard.accounts.map((account) =>
      account.id === id ? { ...account, enabled } : account,
    ),
  }))

export const useRemoveAccount = () =>
  useDashboardMutation(removeAccount, (dashboard, id) => ({
    ...dashboard,
    accounts: dashboard.accounts.filter((account) => account.id !== id),
  }))

/** Who Claude Code is logged in as; polled fast while the "Add account" modal is open. */
export const useCurrentLogin = () =>
  useQuery({ queryKey: ['current-login'], queryFn: fetchCurrentLogin, refetchInterval: 3000 })

export function useImportCurrentLogin() {
  const client = useQueryClient()
  const t = useTranslations('errors')
  return useMutation({
    mutationFn: (label: string) => importCurrentLogin(label),
    onError: () => toast.add({ title: t('importFailed'), type: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

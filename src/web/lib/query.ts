import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDashboard, type Locale, type Preferences, patchPreferences, type Theme } from './api'

export const createQueryClient = () =>
  new QueryClient({
    // Polling pauses while the tab is hidden (refetchIntervalInBackground defaults to false).
    defaultOptions: { queries: { refetchInterval: 10_000, retry: 1 } },
  })

const dashboardKey = ['dashboard'] as const

export const useDashboard = () => useQuery({ queryKey: dashboardKey, queryFn: fetchDashboard })

type Dashboard = Awaited<ReturnType<typeof fetchDashboard>>

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

/** PATCH /preferences with an optimistic cache update, rolled back on error. */
export function useUpdatePreferences() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: patchPreferences,
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: dashboardKey })
      const previous = client.getQueryData<Dashboard>(dashboardKey)
      if (previous) {
        client.setQueryData<Dashboard>(dashboardKey, {
          ...previous,
          preferences: { ...previous.preferences, ...patch } as Preferences,
        })
      }
      return { previous }
    },
    onError: (_err, _patch, result) => client.setQueryData(dashboardKey, result?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: dashboardKey }),
  })
}

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { useTranslations } from 'use-intl'
import { RouteModal } from './components/route-modal'
import { Dashboard } from './features/dashboard/dashboard'
import { Header } from './features/shell/header'

function RootLayout() {
  const t = useTranslations('app')
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-lg bg-primary text-primary-foreground outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {t('skipToContent')}
      </a>
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1200px] px-4 py-10 outline-none sm:px-6"
      >
        <Outlet />
      </main>
    </>
  )
}

/** The dashboard stays rendered under every modal route (its children). */
function DashboardLayout() {
  return (
    <>
      <Dashboard />
      <Outlet />
    </>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'dashboard',
  component: DashboardLayout,
})
const indexRoute = createRoute({ getParentRoute: () => dashboardRoute, path: '/' })
// Placeholders: T10 fills these modals in.
const settingsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'settings',
  component: function SettingsModal() {
    return <RouteModal title={useTranslations('modal')('settingsTitle')} />
  },
})
const addAccountRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'accounts/new',
  component: function AddAccountModal() {
    return <RouteModal title={useTranslations('modal')('addAccountTitle')} />
  },
})

const removeAccountRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: 'accounts/$id/remove',
  component: function RemoveAccountModal() {
    return <RouteModal title={useTranslations('modal')('removeAccountTitle')} />
  },
})

const routeTree = rootRoute.addChildren([
  dashboardRoute.addChildren([indexRoute, settingsRoute, addAccountRoute, removeAccountRoute]),
])

export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routeTree, ...(history && { history }) })

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

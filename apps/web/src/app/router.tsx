import type { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { safeRedirectTarget } from '../lib/auth-guard'
import { resetUnauthenticated, setUnauthenticatedHandler } from '../lib/api/unauthenticated'
import { NotFoundPage } from '../shell/not-found'

export function createAppRouter({
  queryClient,
  history,
}: {
  queryClient: QueryClient
  /** Tests pass a memory history; the browser app uses the default. */
  history?: RouterHistory
}) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: NotFoundPage,
  })

  // A 401 `unauthenticated` anywhere => ONE redirect to /login (with where to come back to). The
  // notifier fires once per expiry and is re-armed when /login is reached, so there is no loop.
  setUnauthenticatedHandler(() => {
    const current = router.state.location
    if (current.pathname === '/login' || current.pathname === '/register') {
      resetUnauthenticated()
      return
    }
    queryClient.clear()
    void router.navigate({
      to: '/login',
      search: { redirect: safeRedirectTarget(current.href), reason: 'expired' },
      replace: true,
    })
  })
  router.subscribe('onResolved', ({ toLocation }) => {
    if (toLocation.pathname === '/login') resetUnauthenticated()
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

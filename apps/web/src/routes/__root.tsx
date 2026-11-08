// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { RouterContext } from '../app/router-context'
import { ErrorBody, NotFoundPage } from '../shell/not-found'
import { Topbar } from '../shell/topbar'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // An unknown path renders inside the shell, not a blank page.
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => (
    <>
      <Topbar />
      <ErrorBody error={error} />
    </>
  ),
})

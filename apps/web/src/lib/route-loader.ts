import type { QueryClient } from '@tanstack/react-query'

// Route files are frozen after Phase 1, so a feature team cannot add a loader to one. Instead each
// route file calls a function exported from features/<area>/route-loaders.ts, which the owning team
// fills in (prefetch into the Query cache, throw notFound(), ...). The stubs do nothing.
export interface LoaderArgs {
  queryClient: QueryClient
  /** Path params of the matched route, e.g. { projectSlug, routeId }. */
  params: Record<string, string>
}

export type RouteLoader = (args: LoaderArgs) => Promise<void> | void

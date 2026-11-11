// The guard's data source (src/lib/auth-guard.ts calls ONLY getSession and getLandingPath).
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'
import { STALE } from '../../lib/query-client'

export type Session = Awaited<ReturnType<typeof api.auth.me>>

/**
 * The current session, or null when signed out. Cached in the Query cache under `qk.session()`.
 * A 401 means "signed out" here, so it must not trigger the app-wide session-ended redirect.
 */
export async function getSession(queryClient: QueryClient): Promise<Session | null> {
  try {
    return await queryClient.ensureQueryData({
      queryKey: qk.session(),
      queryFn: ({ signal }) =>
        api.auth.me(undefined, { signal, skipUnauthenticatedRedirect: true }),
      staleTime: STALE.session,
    })
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null
    throw error
  }
}

/** Where `/` and a fresh sign-in land: the first workspace, or /welcome when there is none. */
export function getLandingPath(session: Session | null): string {
  if (!session) return '/login'
  const first = session.workspaces[0]
  return first ? `/w/${encodeURIComponent(first.slug)}` : '/welcome'
}

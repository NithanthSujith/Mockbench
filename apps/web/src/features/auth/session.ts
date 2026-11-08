// STUB (FND-13). AUTH-03 owns this file: it fills in the real session handling.
// The router guard (src/lib/auth-guard.ts) calls ONLY the two functions exported here.
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

/** Where `/` and a fresh sign-in land. Stub: the sign-in screen until AUTH-03 decides. */
export function getLandingPath(session: Session | null): string {
  void session
  return '/login'
}

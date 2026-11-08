import { QueryClient } from '@tanstack/react-query'
import { isApiError } from './api/errors'

/** staleTime presets, in ms. The route tree changes only when the user changes it, so it is "high". */
export const STALE = {
  default: 30_000,
  /** Route list, case list, presets: change only through this UI (DESIGN, TanStack Query note). */
  routeTree: 10 * 60_000,
  session: 5 * 60_000,
} as const

/** Do not retry client errors (4xx incl. 401/403/404/409/422): they will not change by retrying. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false
  if (isApiError(error) && error.status === 501) return false
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.default,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { qk, type RequestLogFilters } from '../../lib/query-keys'

export const LOG_PAGE_SIZE = 50
export const LOG_POLL_MS = 3000

const tabVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Filters become the query key, so changing one starts a fresh query at the first page. */
export function requestsInfiniteOptions(
  projectId: string,
  filters: RequestLogFilters,
  poll: boolean,
) {
  return {
    queryKey: qk.project(projectId).requests(filters),
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.requests.list(
        {
          params: { projectId },
          query: {
            limit: LOG_PAGE_SIZE,
            cursor: pageParam,
            status: filters.status,
            method: filters.method,
            path: filters.path,
            since: filters.since,
            mockError: filters.mockError ? ('true' as const) : undefined,
          },
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    // Only while the tab is visible; TanStack also skips background tabs by default.
    refetchInterval: poll ? () => (tabVisible() ? LOG_POLL_MS : false) : (false as const),
    refetchIntervalInBackground: false,
  }
}

export function useRequests(
  projectId: string | undefined,
  filters: RequestLogFilters,
  poll: boolean,
) {
  return useInfiniteQuery({
    ...requestsInfiniteOptions(projectId ?? '', filters, poll),
    enabled: projectId !== undefined,
  })
}

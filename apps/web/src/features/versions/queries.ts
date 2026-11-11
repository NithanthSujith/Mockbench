import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'
import { projectBySlugOptions } from '../routes/queries'

export const VERSION_PAGE_SIZE = 25

export function versionsInfiniteOptions(projectId: string) {
  return {
    queryKey: qk.project(projectId).versions,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.versions.list(
        { params: { projectId }, query: { limit: VERSION_PAGE_SIZE, cursor: pageParam } },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  }
}

export function deploymentsInfiniteOptions(projectId: string) {
  return {
    queryKey: qk.project(projectId).deployments,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.deployments.list(
        { params: { projectId }, query: { limit: VERSION_PAGE_SIZE, cursor: pageParam } },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  }
}

export function useVersions(projectId: string | undefined) {
  return useInfiniteQuery({
    ...versionsInfiniteOptions(projectId ?? ''),
    enabled: projectId !== undefined,
  })
}

export function useDeployments(projectId: string | undefined) {
  return useInfiniteQuery({
    ...deploymentsInfiniteOptions(projectId ?? ''),
    enabled: projectId !== undefined,
  })
}

/** The project in the URL (its `activeVersion` drives the topbar pill). Shares the shell's query. */
export function useProjectForVersions(slug: string | undefined) {
  return useQuery({ ...projectBySlugOptions(slug ?? ''), enabled: slug !== undefined })
}

/** After a publish, deploy or delete: refetch versions, deployments and the project's activeVersion. */
export function useRefreshVersions() {
  const queryClient = useQueryClient()
  return async (projectId: string, slug: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.project(projectId).versions }),
      queryClient.invalidateQueries({ queryKey: qk.project(projectId).deployments }),
      queryClient.invalidateQueries({ queryKey: qk.projectBySlug(slug) }),
    ])
  }
}

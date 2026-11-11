import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { api } from '../../lib/api/client'
import { STALE } from '../../lib/query-client'
import { qk } from '../../lib/query-keys'

export const PROJECT_PAGE_SIZE = 50

export function projectsInfiniteOptions(workspaceId: string) {
  return {
    queryKey: qk.projects(workspaceId),
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.projects.list(
        { query: { workspaceId, limit: PROJECT_PAGE_SIZE, cursor: pageParam } },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  }
}

/** The workspace's projects, page by page ("Load more"). Disabled until the workspace is known. */
export function useWorkspaceProjects(workspaceId: string | undefined) {
  return useInfiniteQuery({
    ...projectsInfiniteOptions(workspaceId ?? ''),
    enabled: workspaceId !== undefined,
  })
}

/** The signed-in session (shared with the route guard through `qk.session()`). */
export function useSessionState() {
  return useQuery({
    queryKey: qk.session(),
    queryFn: ({ signal }) => api.auth.me(undefined, { signal, skipUnauthenticatedRedirect: true }),
    staleTime: STALE.session,
  })
}

/**
 * The workspace the user is looking at: from `/w/$wsSlug`, or (inside a project) the workspace that
 * owns `/p/$projectSlug`. `canCreate` is false for viewers and while the role is unknown.
 */
export function useCurrentWorkspace() {
  const { wsSlug, projectSlug } = useParams({ strict: false })
  const session = useSessionState()
  const project = useQuery({
    queryKey: qk.projectBySlug(projectSlug ?? ''),
    queryFn: ({ signal }) =>
      api.projects.getBySlug({ params: { slug: projectSlug ?? '' } }, { signal }),
    enabled: !wsSlug && projectSlug !== undefined,
  })
  const workspaces = session.data?.workspaces ?? []
  const workspace = wsSlug
    ? workspaces.find((w) => w.slug === wsSlug)
    : workspaces.find((w) => w.id === project.data?.workspaceId)
  return {
    workspace,
    loading: session.isPending || (!wsSlug && projectSlug !== undefined && project.isPending),
    canCreate: workspace !== undefined && workspace.role !== 'viewer',
    currentProjectSlug: projectSlug,
  }
}

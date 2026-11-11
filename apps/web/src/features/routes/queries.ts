import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { STALE } from '../../lib/query-client'
import { qk } from '../../lib/query-keys'

/** The project in the URL. Same key and function as the router loader and the topbar, so one request. */
export function projectBySlugOptions(slug: string) {
  return {
    queryKey: qk.projectBySlug(slug),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.projects.getBySlug({ params: { slug } }, { signal }),
  }
}

/** All routes of a project in creation order (the contract returns them unpaginated). */
export function projectRoutesOptions(projectId: string) {
  return {
    queryKey: qk.project(projectId).routes,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.routes.list({ params: { projectId } }, { signal }),
    staleTime: STALE.routeTree,
  }
}

export function useProjectBySlug(slug: string) {
  return useQuery(projectBySlugOptions(slug))
}

export function useProjectRoutes(projectId: string | undefined) {
  return useQuery({ ...projectRoutesOptions(projectId ?? ''), enabled: projectId !== undefined })
}

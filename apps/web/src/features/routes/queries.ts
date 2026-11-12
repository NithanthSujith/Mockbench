import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { ResponseCase } from '@mockbench/api-contract'
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

export type CaseList = { items: ResponseCase[]; nextCursor: null }
export type CasePatch = Partial<
  Pick<ResponseCase, 'name' | 'statusCode' | 'schema' | 'headers' | 'delayMs'>
>

export function routeDetailOptions(projectId: string, routeId: string) {
  return {
    queryKey: qk.route(projectId, routeId).detail,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.routes.get({ params: { routeId } }, { signal }),
    staleTime: STALE.routeTree,
  }
}

export function routeCasesOptions(projectId: string, routeId: string) {
  return {
    queryKey: qk.route(projectId, routeId).cases,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.cases.list({ params: { routeId } }, { signal }),
    staleTime: STALE.routeTree,
  }
}

/** The route and the rail carry case summaries: refresh them after a case change. */
export function invalidateRouteSummaries(
  queryClient: QueryClient,
  projectId: string,
  routeId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.route(projectId, routeId).detail }),
    queryClient.invalidateQueries({ queryKey: qk.project(projectId).routes }),
  ])
}

/**
 * Optimistic cases.update: the cached case changes immediately; on a server error the patched
 * fields go back to their previous values and the error is rethrown for the caller to display.
 */
export async function patchCase(
  queryClient: QueryClient,
  projectId: string,
  routeId: string,
  caseId: string,
  patch: CasePatch,
): Promise<ResponseCase> {
  const key = qk.route(projectId, routeId).cases
  const previous = queryClient.getQueryData<CaseList>(key)?.items.find((c) => c.id === caseId)
  const apply = (fields: Partial<ResponseCase>) =>
    queryClient.setQueryData<CaseList>(key, (list) =>
      list
        ? { ...list, items: list.items.map((c) => (c.id === caseId ? { ...c, ...fields } : c)) }
        : list,
    )
  apply(patch)
  try {
    const saved = await api.cases.update({ params: { caseId }, body: patch })
    apply(saved)
    void invalidateRouteSummaries(queryClient, projectId, routeId)
    return saved
  } catch (error) {
    if (previous) {
      const back: Record<string, unknown> = {}
      for (const field of Object.keys(patch)) {
        back[field] = (previous as Record<string, unknown>)[field]
      }
      apply(back as Partial<ResponseCase>)
    }
    throw error
  }
}

export function useRouteDetail(projectId: string | undefined, routeId: string) {
  return useQuery({
    ...routeDetailOptions(projectId ?? '', routeId),
    enabled: projectId !== undefined,
  })
}

export function useRouteCases(projectId: string | undefined, routeId: string) {
  return useQuery({
    ...routeCasesOptions(projectId ?? '', routeId),
    enabled: projectId !== undefined,
  })
}

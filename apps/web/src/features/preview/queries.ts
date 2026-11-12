import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'

/** The project's settings and components: the inputs of local generation. */
export function usePreviewProject(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId).detail,
    queryFn: ({ signal }) => api.projects.get({ params: { projectId } }, { signal }),
  })
}

/**
 * The project's presets. Always stale, so coming back from the Presets screen refetches; the screen
 * that edits them also invalidates `qk.project(id).presets`.
 */
export function usePreviewPresets(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId).presets,
    queryFn: ({ signal }) => api.presets.list({ params: { projectId } }, { signal }),
    staleTime: 0,
  })
}

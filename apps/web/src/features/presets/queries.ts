import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'

/** A project's presets (`presets.list`), in the server's order: priority desc, then oldest first. */
export function usePresets(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? '').presets,
    queryFn: ({ signal }) =>
      api.presets.list({ params: { projectId: projectId ?? '' } }, { signal }),
    enabled: projectId !== undefined,
  })
}

import type { MockNode } from '@mockbench/schema-core'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'
import { usePreviewProject } from '../preview/queries'

/**
 * The project's components and the one call that changes them. `save` sends the whole map in a single
 * `projects.update` (components are replaced wholesale, API-CONTRACT 1.7) and puts the answer in the
 * project caches, so the preview picks the change up. A refusal (`component_in_use`) is rethrown for
 * the dialog to show.
 */
export function useProjectComponents(projectId: string) {
  const queryClient = useQueryClient()
  const project = usePreviewProject(projectId)
  const save = useCallback(
    async (next: Record<string, MockNode>) => {
      const updated = await api.projects.update({
        params: { projectId },
        body: { components: next } as never,
      })
      queryClient.setQueryData(qk.projectBySlug(updated.slug), updated)
      queryClient.setQueryData(qk.project(projectId).detail, updated)
    },
    [projectId, queryClient],
  )
  return { components: project.data?.components as Record<string, MockNode> | undefined, save }
}

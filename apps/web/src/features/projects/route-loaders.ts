import { getSession } from '../auth/session'
import { api } from '../../lib/api/client'
import { qk } from '../../lib/query-keys'
import type { RouteLoader } from '../../lib/route-loader'
import { projectsInfiniteOptions } from './queries'

/** Warm the project list for the workspace in the URL. Never blocks or fails the navigation. */
export const workspaceProjectsLoader: RouteLoader = async ({ queryClient, params }) => {
  try {
    const session = await getSession(queryClient)
    const workspace = session?.workspaces.find((w) => w.slug === params.wsSlug)
    if (workspace) await queryClient.prefetchInfiniteQuery(projectsInfiniteOptions(workspace.id))
  } catch {
    // The screen shows its own error state.
  }
}

/** Warm the project for the settings screen. Never blocks or fails the navigation. */
export const settingsLoader: RouteLoader = async ({ queryClient, params }) => {
  const slug = params.projectSlug
  if (!slug) return
  try {
    await queryClient.prefetchQuery({
      queryKey: qk.projectBySlug(slug),
      queryFn: ({ signal }) => api.projects.getBySlug({ params: { slug } }, { signal }),
    })
  } catch {
    // The screen shows its own error state.
  }
}

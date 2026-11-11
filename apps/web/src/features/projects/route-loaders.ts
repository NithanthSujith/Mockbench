import { getSession } from '../auth/session'
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

// STUB (FND-13): PRJ-05 fills this in.
export const settingsLoader: RouteLoader = () => {}

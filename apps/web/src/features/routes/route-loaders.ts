import { notFound } from '@tanstack/react-router'
import { isApiError } from '../../lib/api/errors'
import type { RouteLoader } from '../../lib/route-loader'
import {
  projectBySlugOptions,
  projectRoutesOptions,
  routeCasesOptions,
  routeDetailOptions,
} from './queries'

/**
 * Loads the project into the Query cache. A project the caller cannot see answers 404 (or 403), and
 * both render the same not-found screen, so the page never reveals that the slug exists.
 */
export const projectLoader: RouteLoader = async ({ queryClient, params }) => {
  let project
  try {
    project = await queryClient.ensureQueryData(projectBySlugOptions(params.projectSlug ?? ''))
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) throw notFound()
    throw error
  }
  // Warm the rail. A failure here is shown by the rail itself, not by failing the navigation.
  try {
    await queryClient.prefetchQuery(projectRoutesOptions(project.id))
  } catch {
    // ignored on purpose
  }
}

/** Loads the route and its cases; a route that does not exist (or is not visible) is not-found. */
export const routeEditorLoader: RouteLoader = async ({ queryClient, params }) => {
  try {
    const project = await queryClient.ensureQueryData(
      projectBySlugOptions(params.projectSlug ?? ''),
    )
    const routeId = params.routeId ?? ''
    await Promise.all([
      queryClient.ensureQueryData(routeDetailOptions(project.id, routeId)),
      queryClient.ensureQueryData(routeCasesOptions(project.id, routeId)),
    ])
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) throw notFound()
    throw error
  }
}

// Module "routes": owns the endpoint areas below. The TYPE only admits ids of these areas, so binding
// another team's endpoint is a compile error. Database logic lives in ./service.
import { loadProjectForUser, loadRouteForUser } from '../../access'
import { authOf } from '../../http/auth'
import type { ModuleHandlers } from '../../http/types'
import {
  createRoute,
  deleteRoute,
  duplicateRoute,
  fetchRoute,
  listRoutes,
  updateRoute,
} from './service'

export const areas = ['routes'] as const

export const handlers: ModuleHandlers<'routes'> = {
  'routes.list': async (ctx, { params }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'viewer')
    return {
      status: 200,
      body: { items: await listRoutes(ctx.db, params.projectId), nextCursor: null },
    }
  },

  'routes.create': async (ctx, { params, body }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'editor')
    const route = await createRoute(ctx.db, params.projectId, body)
    return { status: 201, body: route }
  },

  'routes.get': async (ctx, { params }) => {
    await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'viewer')
    return { status: 200, body: await fetchRoute(ctx.db, params.routeId) }
  },

  'routes.update': async (ctx, { params, body }) => {
    const { entity } = await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'editor')
    return { status: 200, body: await updateRoute(ctx.db, entity, body) }
  },

  'routes.delete': async (ctx, { params }) => {
    await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'editor')
    await deleteRoute(ctx.db, params.routeId)
    return { status: 204 }
  },

  'routes.duplicate': async (ctx, { params, body }) => {
    const { entity } = await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'editor')
    return { status: 201, body: await duplicateRoute(ctx.db, entity, body) }
  },
}

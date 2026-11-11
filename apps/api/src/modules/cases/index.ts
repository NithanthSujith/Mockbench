// Module "cases": owns the endpoint areas below. The TYPE only admits ids of these areas, so binding
// another team's endpoint is a compile error. Database logic lives in ./service.
import { loadCaseForUser, loadRouteForUser } from '../../access'
import { authOf } from '../../http/auth'
import type { ModuleHandlers } from '../../http/types'
import { createCase, deleteCase, fetchCase, listCases, setDefaultCase, updateCase } from './service'

export const areas = ['cases'] as const

export const handlers: ModuleHandlers<'cases'> = {
  'cases.list': async (ctx, { params }) => {
    await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'viewer')
    return {
      status: 200,
      body: { items: await listCases(ctx.db, params.routeId), nextCursor: null },
    }
  },

  'cases.create': async (ctx, { params, body }) => {
    const { entity } = await loadRouteForUser(ctx.db, authOf(ctx).userId, params.routeId, 'editor')
    return { status: 201, body: await createCase(ctx.db, entity, body) }
  },

  'cases.get': async (ctx, { params }) => {
    await loadCaseForUser(ctx.db, authOf(ctx).userId, params.caseId, 'viewer')
    return { status: 200, body: await fetchCase(ctx.db, params.caseId) }
  },

  'cases.update': async (ctx, { params, body }) => {
    const { entity, projectId } = await loadCaseForUser(
      ctx.db,
      authOf(ctx).userId,
      params.caseId,
      'editor',
    )
    return { status: 200, body: await updateCase(ctx.db, entity, projectId, body) }
  },

  'cases.delete': async (ctx, { params }) => {
    const { entity } = await loadCaseForUser(ctx.db, authOf(ctx).userId, params.caseId, 'editor')
    await deleteCase(ctx.db, entity)
    return { status: 204 }
  },

  'cases.setDefault': async (ctx, { params }) => {
    const { entity } = await loadCaseForUser(ctx.db, authOf(ctx).userId, params.caseId, 'editor')
    return { status: 200, body: await setDefaultCase(ctx.db, entity) }
  },
}

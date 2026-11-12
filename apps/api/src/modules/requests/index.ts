// Module "requests": owns the endpoint areas below. RUN-08 binds `requests.list`.
import { loadProjectForUser } from '../../access'
import { authOf } from '../../http/auth'
import type { ModuleHandlers } from '../../http/types'
import { listRequests } from './service'

export const areas = ['requests'] as const

export const handlers: ModuleHandlers<'requests'> = {
  'requests.list': async (ctx, { params, query }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'viewer')
    const { limit, cursor, ...filters } = query
    return {
      status: 200,
      body: await listRequests(ctx.db, params.projectId, filters, limit, cursor),
    }
  },
}

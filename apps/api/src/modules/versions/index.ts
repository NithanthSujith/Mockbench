// Module "versions": owns the endpoint areas below. RUN-02 binds `versions.{list,publish,get,delete}`;
// RUN-03 binds `deploy.create` and `deployments.list`; cache stays unbound. The TYPE only admits ids of these areas.
import { loadProjectForUser, loadVersionForUser } from '../../access'
import { authOf } from '../../http/auth'
import type { ModuleHandlers } from '../../http/types'
import { deployVersion, listDeployments } from './deploy'
import { deleteVersion, fetchVersion, listVersions, publishVersion } from './service'

export const areas = ['versions', 'deploy', 'deployments', 'cache'] as const

export const handlers: ModuleHandlers<'versions' | 'deploy' | 'deployments' | 'cache'> = {
  'versions.list': async (ctx, { params, query }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'viewer')
    return {
      status: 200,
      body: await listVersions(ctx.db, params.projectId, query.limit, query.cursor),
    }
  },

  'versions.publish': async (ctx, { params, body }) => {
    const { userId } = authOf(ctx)
    await loadProjectForUser(ctx.db, userId, params.projectId, 'editor')
    return { status: 201, body: await publishVersion(ctx.db, params.projectId, userId, body) }
  },

  'versions.get': async (ctx, { params }) => {
    await loadVersionForUser(ctx.db, authOf(ctx).userId, params.versionId, 'viewer')
    return { status: 200, body: await fetchVersion(ctx.db, params.versionId) }
  },

  'versions.delete': async (ctx, { params }) => {
    await loadVersionForUser(ctx.db, authOf(ctx).userId, params.versionId, 'editor')
    await deleteVersion(ctx.db, params.versionId)
    return { status: 204 }
  },

  'deploy.create': async (ctx, { params, body }) => {
    const { userId } = authOf(ctx)
    await loadProjectForUser(ctx.db, userId, params.projectId, 'editor')
    const { deployment, changed } = await deployVersion(
      ctx.db,
      params.projectId,
      userId,
      body.versionId,
    )
    // After commit; the hook registry logs and swallows listener failures.
    if (changed) await ctx.hooks.onVersionDeployed.emit(params.projectId)
    return { status: 200, body: deployment }
  },

  'cache.flush': async (ctx, { params }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'editor')
    await ctx.hooks.onCacheFlushRequested.emit(params.projectId)
    return { status: 204 }
  },

  'deployments.list': async (ctx, { params, query }) => {
    await loadProjectForUser(ctx.db, authOf(ctx).userId, params.projectId, 'viewer')
    return {
      status: 200,
      body: await listDeployments(ctx.db, params.projectId, query.limit, query.cursor),
    }
  },
}

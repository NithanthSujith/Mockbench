// System endpoints (instance info, liveness, readiness, the OpenAPI document). Owned by Core: these
// are implemented for real in FND-10 because the container healthchecks and the login screen need them.
import { registry } from '@mockbench/api-contract'
import { generateOpenApi } from '@mockbench/api-contract/openapi'
import { sql } from 'drizzle-orm'
import { users } from '../../db/schema'
import { HttpError } from '../../http/errors'
import type { ModuleHandlers } from '../../http/types'
import pkg from '../../../package.json' with { type: 'json' }

export const areas = ['system'] as const

const READY_TIMEOUT_MS = 2000

let openApiDocument: ReturnType<typeof generateOpenApi> | undefined

export const handlers: ModuleHandlers<'system'> = {
  'system.instance': async (ctx) => {
    const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users)
    return {
      status: 200,
      body: {
        name: 'Mockbench',
        version: pkg.version,
        allowSignup: ctx.config.allowSignup,
        // Zero users: registration is open regardless of ALLOW_SIGNUP (first-run setup).
        setupRequired: (row?.n ?? 0) === 0,
      },
    }
  },

  'system.healthz': async () => ({ status: 200, body: { status: 'ok' } }),

  'system.readyz': async (ctx) => {
    try {
      await Promise.race([
        ctx.pool.query('select 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('database check timed out')), READY_TIMEOUT_MS).unref(),
        ),
      ])
    } catch (err) {
      ctx.log.warn({ err }, 'readiness check failed')
      throw new HttpError(503, 'not_ready', 'The database is not reachable.')
    }
    return { status: 200, body: { status: 'ok', db: 'up' } }
  },

  'system.openapi': async () => {
    openApiDocument ??= generateOpenApi(registry, { version: pkg.version })
    return { status: 200, body: openApiDocument as unknown as Record<string, unknown> }
  },
}

// createApp: ONE Express app, TWO planes (ADR 0011).
//   /mock/*              the data plane  - mounted FIRST, before any cookie/session/CSRF/JSON handling
//   everything else      the control plane (`/api/v1/*` + root health aliases)
import { registry } from '@mockbench/api-contract'
import type { EndpointDef } from '@mockbench/api-contract'
import express from 'express'
import type { Express } from 'express'
import type { Pool } from 'pg'
import type { Config } from './config'
import type { Db } from './db/client'
import { createControlPlane } from './http/control-plane'
import { createHooks } from './http/hooks'
import type { Hooks } from './http/hooks'
import { createLogger } from './http/logger'
import type { Logger } from './http/logger'
import type { Handler, ModuleDefinition } from './http/types'
import { createSessionAuth } from './modules/auth/session-middleware'
import { createDataPlaneRouter, registerVersionCache } from './modules/dataplane'
import type { RequestLog } from './modules/dataplane'
import { modules as defaultModules } from './modules'
import type { ModuleMap } from './modules'

export interface AppDeps {
  config: Config
  db: Db
  pool: Pool
  logger?: Logger
  hooks?: Hooks
  /** Override the module set (tests). Default: the real modules. */
  modules?: ModuleMap
  /** Override the endpoint set (tests). Default: the contract registry. */
  endpoints?: readonly EndpointDef[]
  /** Called with each control-plane middleware step name as it runs (tests). */
  trace?: (step: string) => void
  now?: () => number
  /** RUN-07: the request-log writer (server.ts creates it). Default: discards entries. */
  requestLog?: RequestLog
}

/** Merges every module's handlers, refusing any handler outside the module's own areas. */
export function collectHandlers(
  moduleMap: ModuleMap,
  endpoints: readonly EndpointDef[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Map<string, Handler<any>> {
  const known = new Set(endpoints.map((e) => e.id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = new Map<string, Handler<any>>()
  for (const [name, mod] of Object.entries(moduleMap) as [string, ModuleDefinition][]) {
    for (const [id, handler] of Object.entries(mod.handlers)) {
      if (!handler) continue
      if (!known.has(id)) throw new Error(`module "${name}" binds unknown endpoint "${id}"`)
      if (!mod.areas.some((a) => id.startsWith(`${a}.`))) {
        throw new Error(
          `module "${name}" owns areas [${mod.areas.join(', ')}] but binds "${id}" (another module's endpoint)`,
        )
      }
      if (out.has(id)) throw new Error(`endpoint "${id}" is bound by more than one module`)
      out.set(id, handler)
    }
  }
  return out
}

export function createApp(deps: AppDeps): Express {
  const { config, db, pool } = deps
  const logger = deps.logger ?? createLogger(config)
  const hooks = deps.hooks ?? createHooks(logger)
  const moduleMap = deps.modules ?? defaultModules
  const endpoints = deps.endpoints ?? (registry.endpoints as readonly EndpointDef[])

  const handlers = collectHandlers(moduleMap, endpoints)
  for (const mod of Object.values(moduleMap) as ModuleDefinition[]) {
    mod.init?.({ db, pool, config, hooks, log: logger })
  }

  // RUN-06: one version cache per app; it listens to the deploy / delete / flush hooks.
  const versionCache = registerVersionCache(hooks, {
    db,
    maxMb: config.mockCacheMaxMb,
    log: logger.child({ plane: 'data' }),
  })

  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)
  app.set('trust proxy', config.trustProxy)

  // Data plane FIRST: nothing from the control plane may run for /mock/*.
  app.use(
    '/mock',
    createDataPlaneRouter({
      logger,
      cache: versionCache,
      requestLog: deps.requestLog,
      rateLimit: config.mockRateLimit,
    }),
  )

  app.use(
    createControlPlane({
      config,
      db,
      pool,
      logger,
      hooks,
      sessionAuth: createSessionAuth({ db, config }),
      handlers,
      endpoints,
      trace: deps.trace,
      now: deps.now,
    }),
  )

  return app
}

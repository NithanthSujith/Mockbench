// Test helpers for the FND-10 suites: a real Postgres (FND-09 harness), a captured pino stream, and
// a way to create a session cookie. FND-11 supersedes the session helper with the shared factories.
import type { EndpointDef } from '@mockbench/api-contract'
import type { Express } from 'express'
import type { DestinationStream } from 'pino'
import { createApp } from '../app'
import type { AppDeps } from '../app'
import type { Config } from '../config'
import { createDb } from '../db/client'
import type { Db } from '../db/client'
import { createLogger } from '../http/logger'
import { withTestDb } from '../db/testing'
import type { TestDb } from '../db/testing'
import type { ModuleMap } from '../modules'
import { TEST_SESSION_SECRET, createTestSession } from '../testing/sessions'
import { createUser } from '../testing/factories'
import { logSink, testConfig } from '../testing/test-app'
import type { LogSink } from '../testing/test-app'

export { logSink, testConfig }
export type { LogSink }

export const TEST_SECRET = TEST_SESSION_SECRET

export interface TestApp {
  app: Express
  config: Config
  db: Db
  url: string
  logs: LogSink
  /** Creates a user + live session and returns the Cookie header value. */
  session(opts?: { expired?: boolean; inactive?: boolean }): Promise<{
    cookie: string
    userId: string
    sessionId: string
  }>
  drop(): Promise<void>
}

/** App on a fresh migrated database. `env` overrides config, `deps` overrides createApp deps. */
export async function makeApp(
  opts: {
    env?: Record<string, string>
    modules?: ModuleMap
    endpoints?: readonly EndpointDef[]
    trace?: (step: string) => void
    deps?: Partial<AppDeps>
  } = {},
): Promise<TestApp> {
  const t: TestDb = await withTestDb()
  const config = testConfig(t.url, opts.env)
  const logs = logSink()
  const logger = createLogger(config, logs.stream as unknown as DestinationStream)
  const app = createApp({
    config,
    db: t.db,
    pool: t.pool,
    logger,
    modules: opts.modules,
    endpoints: opts.endpoints,
    trace: opts.trace,
    ...opts.deps,
  })

  async function session(o: { expired?: boolean; inactive?: boolean } = {}) {
    const user = await createUser(t.db, { isActive: !o.inactive })
    const s = await createTestSession(t.db, user.id, { expired: o.expired, secret: TEST_SECRET })
    return { cookie: s.cookie, userId: s.userId, sessionId: s.sessionId }
  }

  return { app, config, db: t.db, url: t.url, logs, session, drop: () => t.drop() }
}

/** An app whose pool cannot reach any database (for readiness failure tests). */
export function makeUnreachableApp() {
  const config = testConfig('postgres://mock:mock@127.0.0.1:1/none')
  const logs = logSink()
  const handle = createDb(config.databaseUrl, { max: 1, onError: () => {} })
  const logger = createLogger(config, logs.stream as unknown as DestinationStream)
  const app = createApp({ config, db: handle.db, pool: handle.pool, logger })
  return { app, logs, close: () => handle.close() }
}

/** Concrete URL for a registry path: every `:param` becomes a UUID. */
export function concretePath(path: string): string {
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '0190f3a2-7b1c-7d4e-8a5b-123456789abc')
}

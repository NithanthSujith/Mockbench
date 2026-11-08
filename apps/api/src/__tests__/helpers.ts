// Test helpers for the FND-10 suites: a real Postgres (FND-09 harness), a captured pino stream, and
// a way to create a session cookie. FND-11 supersedes the session helper with the shared factories.
import { randomBytes } from 'node:crypto'
import type { EndpointDef } from '@mockbench/api-contract'
import type { Express } from 'express'
import type { DestinationStream } from 'pino'
import { createApp } from '../app'
import type { AppDeps } from '../app'
import { hashSessionToken } from '../access/session-token'
import { loadConfig } from '../config'
import type { Config } from '../config'
import { createDb } from '../db/client'
import type { Db } from '../db/client'
import { sessions, users } from '../db/schema'
import { SESSION_COOKIE } from '../http/cookies'
import { createLogger } from '../http/logger'
import { withTestDb } from '../db/testing'
import type { TestDb } from '../db/testing'
import type { ModuleMap } from '../modules'

export const TEST_SECRET = 'test-session-secret'

export interface LogSink {
  lines: Record<string, unknown>[]
  stream: { write(chunk: string): void }
}

export function logSink(): LogSink {
  const lines: Record<string, unknown>[] = []
  return {
    lines,
    stream: {
      write(chunk: string) {
        for (const l of chunk.split('\n')) if (l.trim()) lines.push(JSON.parse(l))
      },
    },
  }
}

export function testConfig(databaseUrl: string, env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: TEST_SECRET,
    ...env,
  })
}

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
    const token = randomBytes(32).toString('base64url')
    const [u] = await t.db
      .insert(users)
      .values({
        email: `u-${randomBytes(4).toString('hex')}@example.test`,
        passwordHash: 'not-a-real-hash',
        name: 'Test User',
        isActive: !o.inactive,
      })
      .returning({ id: users.id })
    const expiresAt = new Date(Date.now() + (o.expired ? -60_000 : 3_600_000))
    const [s] = await t.db
      .insert(sessions)
      .values({ userId: u!.id, tokenHash: hashSessionToken(token, TEST_SECRET), expiresAt })
      .returning({ id: sessions.id })
    return { cookie: `${SESSION_COOKIE}=${token}`, userId: u!.id, sessionId: s!.id }
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

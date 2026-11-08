// testApp(): the real Express app on a fresh, migrated Postgres (FND-09 harness) plus everything a
// test needs to act on it: factories, sessions, a cookie/CSRF-aware supertest client and the
// contract assertion. This is what every slice team writes its handler tests against.
import type { EndpointDef } from '@mockbench/api-contract'
import type { Express } from 'express'
import type { DestinationStream } from 'pino'
import type { Pool } from 'pg'
import request from 'supertest'
import { createApp } from '../app'
import type { AppDeps } from '../app'
import { loadConfig } from '../config'
import type { Config } from '../config'
import type { Db } from '../db/client'
import { withTestDb } from '../db/testing'
import type { TestDb } from '../db/testing'
import { createLogger } from '../http/logger'
import type { ModuleMap } from '../modules'
import { assertContract, pathFor } from './contract'
import type { ResponseLike } from './contract'
import { factories } from './factories'
import type { Factories } from './factories'
import { TEST_SESSION_SECRET, createTestSession } from './sessions'
import type { CreateTestSessionOptions, TestSession } from './sessions'

export interface LogSink {
  lines: Record<string, unknown>[]
  stream: { write(chunk: string): void }
}

/** A pino destination that collects parsed JSON lines instead of printing them. */
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

/** Config for tests: NODE_ENV=test, the fixed test session secret, env overrides on top. */
export function testConfig(databaseUrl: string, env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: TEST_SESSION_SECRET,
    ...env,
  })
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface TestClient {
  get(path: string): request.Test
  post(path: string): request.Test
  put(path: string): request.Test
  patch(path: string): request.Test
  delete(path: string): request.Test
}

export interface TestApp {
  app: Express
  config: Config
  db: Db
  pool: Pool
  url: string
  logs: LogSink
  /** Row factories bound to this database. */
  f: Factories
  /** Creates a live session (and its user, when `userId` is omitted). */
  session(userId?: string, opts?: CreateTestSessionOptions): Promise<TestSession>
  /**
   * A supertest client. With a session it sends the cookie; every non-GET request also carries the
   * `X-Mockbench-Client` CSRF header, as the web client does.
   */
  as(session?: Pick<TestSession, 'cookie'>): TestClient
  /** Path for an endpoint id with params filled in (see testing/contract.ts). */
  pathFor: typeof pathFor
  /** Fails unless `res` is a response the contract allows for `endpointId`; returns the parsed body. */
  assertContract(endpointId: string, res: ResponseLike): unknown
  drop(): Promise<void>
}

export interface TestAppOptions {
  env?: Record<string, string>
  modules?: ModuleMap
  endpoints?: readonly EndpointDef[]
  trace?: (step: string) => void
  deps?: Partial<AppDeps>
}

export async function testApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const t: TestDb = await withTestDb()
  try {
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
    const agent = request(app)

    const call = (method: Method, session?: Pick<TestSession, 'cookie'>) => (path: string) => {
      let test = agent[method](path)
      if (session) test = test.set('Cookie', session.cookie)
      if (method !== 'get') test = test.set('X-Mockbench-Client', 'test')
      return test
    }

    return {
      app,
      config,
      db: t.db,
      pool: t.pool,
      url: t.url,
      logs,
      f: factories(t.db),
      session: (userId, o) =>
        createTestSession(t.db, userId, { secret: config.sessionSecret, ...o }),
      as: (session) => ({
        get: call('get', session),
        post: call('post', session),
        put: call('put', session),
        patch: call('patch', session),
        delete: call('delete', session),
      }),
      pathFor,
      assertContract,
      drop: () => t.drop(),
    }
  } catch (e) {
    await t.drop().catch(() => {})
    throw e
  }
}

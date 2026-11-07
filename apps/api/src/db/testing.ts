// Official Postgres test harness (FND-09). Every call to withTestDb() returns a fresh, isolated,
// migrated database on a real Postgres 16 — no mocks, no testcontainers.
//
//   env TEST_DATABASE_URL  admin connection (default: the local container below; CI sets its service)
//   env MB_TEST_TEMPLATE_DB  set by the vitest global setup: a pre-migrated template database that
//                            makes each withTestDb() a fast `CREATE DATABASE ... TEMPLATE ...`
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createDb } from './client'
import type { Db } from './client'
import { runMigrations } from './migrate'

export const DEFAULT_TEST_DATABASE_URL = 'postgres://mock:mock@127.0.0.1:55432/postgres'
export const TEMPLATE_ENV = 'MB_TEST_TEMPLATE_DB'

export const DOCKER_RUN_HINT =
  'docker run -d --name mockbench-test-pg -e POSTGRES_USER=mock -e POSTGRES_PASSWORD=mock ' +
  '-e POSTGRES_DB=postgres -p 127.0.0.1:55432:5432 postgres:16-alpine'

export function testAdminUrl(): string {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL
}

/** The URL with any password replaced, safe to print. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return '(unparseable url)'
  }
}

function unreachableError(adminUrl: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Cannot reach the test PostgreSQL at ${redactUrl(adminUrl)} (${reason}).\n` +
      `Start one that matches the default with:\n  ${DOCKER_RUN_HINT}\n` +
      `or point TEST_DATABASE_URL at any Postgres 16 superuser connection.`,
  )
}

/** Connects the admin client, converting every failure into the actionable message above. */
export async function connectAdmin(adminUrl: string, connectTimeoutMs = 5000): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: connectTimeoutMs,
  })
  client.on('error', () => {})
  try {
    await client.connect()
  } catch (e) {
    await client.end().catch(() => {})
    throw unreachableError(adminUrl, e)
  }
  return client
}

export interface TestDbOptions {
  /** Apply migrations (default true). `false` gives an empty database. */
  migrate?: boolean
  /** Override the admin URL (used to test the unreachable path). */
  adminUrl?: string
  /** Admin connect timeout. Default 5000 ms. */
  connectTimeoutMs?: number
}

export interface TestDb {
  name: string
  url: string
  db: Db
  pool: pg.Pool
  /** Drops the database. Idempotent; safe to call after a partially failed setup. */
  drop(): Promise<void>
}

async function createFromTemplate(admin: pg.Client, name: string, template: string) {
  // Postgres refuses a TEMPLATE copy while another session is connected to the template (55006).
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`)
      return
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== '55006' || attempt >= 50) throw e
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

export async function withTestDb(opts: TestDbOptions = {}): Promise<TestDb> {
  const adminUrl = opts.adminUrl ?? testAdminUrl()
  const migrate = opts.migrate !== false
  const template = process.env[TEMPLATE_ENV]
  const name = `mb_test_${randomBytes(6).toString('hex')}`
  const url = new URL(adminUrl)
  url.pathname = `/${name}`

  let handle: ReturnType<typeof createDb> | undefined
  let dropped = false

  async function drop(): Promise<void> {
    if (dropped) return
    dropped = true
    await handle?.close().catch(() => {})
    const admin = await connectAdmin(adminUrl, opts.connectTimeoutMs)
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    } finally {
      await admin.end().catch(() => {})
    }
  }

  const admin = await connectAdmin(adminUrl, opts.connectTimeoutMs)
  try {
    if (migrate && template) await createFromTemplate(admin, name, template)
    else await admin.query(`CREATE DATABASE ${name}`)
  } finally {
    await admin.end().catch(() => {})
  }

  try {
    handle = createDb(url.toString(), { max: 4 })
    if (migrate && !template) await runMigrations(handle.db)
  } catch (e) {
    // A failed setup must not leak a database.
    await drop().catch(() => {})
    throw e
  }

  return { name, url: url.toString(), db: handle.db, pool: handle.pool, drop }
}

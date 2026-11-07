// Runtime migrator (FND-09, ADR 0002): drizzle-orm's programmatic migrator, serialised across
// processes/containers with a SESSION-level Postgres advisory lock. drizzle-kit is never used at runtime.
//
// The lock, the migration statements and the bookkeeping all run on ONE dedicated connection, so:
//  - a crashed/killed process releases the lock the moment its connection drops, and
//  - `client_connection_check_interval` (where the server supports it) lets Postgres notice the dead
//    client even while a long statement is running, instead of finishing the statement first.
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { Db } from './client'

/** Fixed advisory-lock key for migrations: the ASCII bytes of "MOCKBENC" as a big-endian int8. */
export const MIGRATION_LOCK_ID = 0x4d4f434b42454e43n

/** Migrations shipped next to this module (override with `opts.migrationsFolder` / `MIGRATIONS_DIR`). */
export const defaultMigrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

export interface MigrateOptions {
  /** Advisory lock key. Default {@link MIGRATION_LOCK_ID}. */
  lockId?: bigint
  /** Delay between connection/lock attempts. Default 500 ms. */
  retryMs?: number
  /** How long to keep retrying to CONNECT before giving up. Default 30 000 ms. */
  timeoutMs?: number
  /** How long to wait for ANOTHER migrator to release the lock. Default 300 000 ms. */
  lockTimeoutMs?: number
  /** Folder containing the SQL migrations and `meta/_journal.json`. */
  migrationsFolder?: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `host:port` of the configured server, for error messages (never includes credentials). */
export function describeTarget(cfg: pg.ClientConfig): string {
  if (cfg.connectionString) {
    try {
      const u = new URL(cfg.connectionString)
      return `${u.hostname || 'localhost'}:${u.port || '5432'}`
    } catch {
      return '(unparseable connection string)'
    }
  }
  return `${cfg.host ?? 'localhost'}:${cfg.port ?? 5432}`
}

async function connectWithRetry(
  cfg: pg.ClientConfig,
  retryMs: number,
  timeoutMs: number,
): Promise<pg.Client> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'unknown error'
  for (;;) {
    const remaining = deadline - Date.now()
    const client = new pg.Client({
      ...cfg,
      connectionTimeoutMillis: Math.max(250, Math.min(5000, remaining)),
    })
    // Errors after a successful connect surface through the query that was running.
    client.on('error', () => {})
    try {
      await client.connect()
      return client
    } catch (e) {
      lastError = (e as Error).message || String(e)
      await client.end().catch(() => {})
    }
    if (Date.now() + retryMs >= deadline) {
      throw new Error(
        `could not connect to PostgreSQL at ${describeTarget(cfg)} within ${timeoutMs}ms (last error: ${lastError})`,
      )
    }
    await sleep(retryMs)
  }
}

async function countApplied(client: pg.Client): Promise<number> {
  const exists = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`)
  if (!exists.rows[0]?.t) return 0
  const r = await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')
  return Number(r.rows[0]?.n ?? 0)
}

/**
 * Applies pending migrations. Safe to call from many processes at once: exactly one runs them,
 * the others wait for the lock and then find nothing left to do.
 */
export async function runMigrations(
  db: Db,
  opts: MigrateOptions = {},
): Promise<{ applied: number }> {
  const lockId = opts.lockId ?? MIGRATION_LOCK_ID
  const retryMs = opts.retryMs ?? 500
  const timeoutMs = opts.timeoutMs ?? 30_000
  const lockTimeoutMs = opts.lockTimeoutMs ?? 300_000
  const migrationsFolder = opts.migrationsFolder ?? defaultMigrationsFolder

  const cfg = (db.$client as pg.Pool).options as pg.ClientConfig
  const client = await connectWithRetry(cfg, retryMs, timeoutMs)
  try {
    // Linux servers only; a failure here just means the extra safety net is unavailable.
    await client.query('SET client_connection_check_interval = 1000').catch(() => {})

    const lockDeadline = Date.now() + lockTimeoutMs
    for (;;) {
      const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [
        lockId.toString(),
      ])
      if (r.rows[0]?.ok) break
      if (Date.now() + retryMs >= lockDeadline) {
        throw new Error(
          `another process has held the migration lock (${lockId}) for more than ${lockTimeoutMs}ms`,
        )
      }
      await sleep(retryMs)
    }

    try {
      const before = await countApplied(client)
      await migrate(drizzle(client), { migrationsFolder })
      const after = await countApplied(client)
      return { applied: after - before }
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1::bigint)', [lockId.toString()])
        .catch(() => {})
    }
  } finally {
    await client.end().catch(() => {})
  }
}

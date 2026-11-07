// Database client (FND-09): one pg pool + Drizzle, with a graceful close.
// Source must stay "erasable" TypeScript (no enums/namespaces/parameter properties) so child-process
// tests can run it under Node's built-in type stripping without a TS runner dependency.
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

export interface CreateDbOptions {
  /** Max pool size. Default 10. */
  max?: number
  /** Called for errors on idle pooled clients (otherwise Node would crash on the unhandled event). */
  onError?: (error: Error) => void
}

export function createDb(url: string, opts: CreateDbOptions = {}) {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 })
  pool.on(
    'error',
    opts.onError ?? ((error) => console.error(`database pool error: ${error.message}`)),
  )
  const db = drizzle(pool, { schema })
  let closed = false
  return {
    db,
    pool,
    /** Ends the pool; idempotent. */
    async close(): Promise<void> {
      if (closed) return
      closed = true
      await pool.end()
    },
  }
}

export type Db = ReturnType<typeof createDb>['db']

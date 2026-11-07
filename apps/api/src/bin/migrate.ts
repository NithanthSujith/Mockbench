// `bin/migrate` — the entry the Docker entrypoint calls before starting the server (FND-09/FND-14).
//   exit 0  migrations applied (or nothing to do); prints `migrate: applied N migration(s)`
//   exit 1  failure; prints ONE line `migrate: failed: <reason>` to stderr
//   exit 2  misconfiguration (no DATABASE_URL)
// Env: DATABASE_URL (required), MIGRATE_TIMEOUT_MS (connect retry budget, default 30000),
//      MIGRATIONS_DIR (override the migrations folder, e.g. in a bundled layout).
// `main` takes its environment as a parameter; the entry guard below passes process.env.
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createDb } from '../db/client'
import { runMigrations } from '../db/migrate'

export interface MigrateResult {
  code: 0 | 1 | 2
  stdout?: string
  stderr?: string
}

export async function main(env: Record<string, string | undefined>): Promise<MigrateResult> {
  const url = env.DATABASE_URL
  if (!url) return { code: 2, stderr: 'migrate: failed: DATABASE_URL is not set' }

  const timeoutMs = env.MIGRATE_TIMEOUT_MS ? Number(env.MIGRATE_TIMEOUT_MS) : undefined
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return { code: 2, stderr: 'migrate: failed: MIGRATE_TIMEOUT_MS must be a positive number' }
  }

  const { db, close } = createDb(url, { max: 1, onError: () => {} })
  try {
    const { applied } = await runMigrations(db, {
      timeoutMs,
      migrationsFolder: env.MIGRATIONS_DIR || undefined,
    })
    return { code: 0, stdout: `migrate: applied ${applied} migration(s)` }
  } catch (e) {
    const reason = ((e as Error).message || String(e)).replace(/\s*\n\s*/g, ' ')
    return { code: 1, stderr: `migrate: failed: ${reason}` }
  } finally {
    await close().catch(() => {})
  }
}

function isEntry(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return pathToFileURL(realpathSync(argv1)).href === import.meta.url
  } catch {
    return false
  }
}

if (isEntry()) {
  const res = await main(process.env)
  if (res.stdout) console.log(res.stdout)
  if (res.stderr) console.error(res.stderr)
  process.exit(res.code)
}

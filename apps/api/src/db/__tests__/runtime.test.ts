import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../client'
import { runMigrations } from '../migrate'
import { withTestDb } from '../testing'
import type { TestDb } from '../testing'
import { migrationsFolder } from './helper'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const apiRoot = here('../../..')
// `--import` needs a file:// URL (a bare drive path is rejected on Windows).
const registerTs = pathToFileURL(here('./fixtures/register-ts.mjs')).href
// Node runs our TypeScript directly (built-in type stripping + the resolver hook): no TS runner dependency.
const nodeTsArgs = ['--no-warnings', '--experimental-strip-types', '--import', registerTs]
const EXPECTED_MIGRATIONS = 3

/** A migrations folder holding one migration that sleeps, to keep the lock held mid-migration. */
function slowMigrationsFolder(seconds: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mb-slow-migration-'))
  mkdirSync(join(dir, 'meta'))
  writeFileSync(join(dir, '0000_slow.sql'), `SELECT pg_sleep(${seconds});\n`)
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, version: '7', when: 1700000000000, tag: '0000_slow', breakpoints: true }],
    }),
  )
  return dir
}

async function migrationRows(t: TestDb): Promise<number> {
  const r = await t.pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')
  return r.rows[0].n as number
}

describe('runMigrations: concurrent migrators', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await withTestDb({ migrate: false })
  })
  afterAll(() => t?.drop())

  it('two concurrent runs both resolve and leave exactly one row per migration', async () => {
    const a = createDb(t.url, { max: 1 })
    const b = createDb(t.url, { max: 1 })
    try {
      const [ra, rb] = await Promise.all([
        runMigrations(a.db, { retryMs: 100 }),
        runMigrations(b.db, { retryMs: 100 }),
      ])
      expect(ra.applied + rb.applied).toBe(EXPECTED_MIGRATIONS)
      expect(await migrationRows(t)).toBe(EXPECTED_MIGRATIONS)
    } finally {
      await a.close()
      await b.close()
    }
  })

  it('a second run is a no-op that reports 0 applied', async () => {
    const c = createDb(t.url, { max: 1 })
    try {
      expect((await runMigrations(c.db)).applied).toBe(0)
      expect(await migrationRows(t)).toBe(EXPECTED_MIGRATIONS)
    } finally {
      await c.close()
    }
  })
})

describe('runMigrations: lock is released when the holder is killed mid-migration', () => {
  let t: TestDb
  let slowDir: string
  beforeAll(async () => {
    t = await withTestDb({ migrate: false })
    slowDir = slowMigrationsFolder(60)
  })
  afterAll(async () => {
    await t?.drop()
    if (slowDir) rmSync(slowDir, { recursive: true, force: true })
  })

  it('a new runMigrations acquires the lock within 5 s of the kill and completes', async () => {
    const child = spawn(
      process.execPath,
      [...nodeTsArgs, here('./fixtures/run-migrations.ts'), t.url, slowDir],
      { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let childErr = ''
    child.stderr.on('data', (d) => (childErr += String(d)))
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))

    // Wait until the child holds the advisory lock AND is inside the sleeping migration statement.
    const deadline = Date.now() + 20_000
    let inMigration = false
    while (Date.now() < deadline && !inMigration) {
      const r = await t.pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
            AND query ILIKE '%pg_sleep%'`,
      )
      inMigration = r.rowCount === 1
      if (!inMigration) await new Promise((res) => setTimeout(res, 100))
    }
    expect(inMigration, `child never reached the migration. stderr: ${childErr}`).toBe(true)
    const locks = await t.pool.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted`,
    )
    expect(locks.rowCount).toBe(1)

    child.kill('SIGKILL')
    await exited
    const killedAt = Date.now()

    const mine = createDb(t.url, { max: 1 })
    try {
      const res = await runMigrations(mine.db, { retryMs: 200 })
      expect(Date.now() - killedAt).toBeLessThan(5000)
      expect(res.applied).toBe(EXPECTED_MIGRATIONS)
      expect(await migrationRows(t)).toBe(EXPECTED_MIGRATIONS)
    } finally {
      await mine.close()
    }
  })
})

describe('runMigrations: unreachable database', () => {
  it('retries for timeoutMs, then rejects with an error naming the host', async () => {
    const dead = createDb('postgres://mock:mock@127.0.0.1:1/nope', { max: 1, onError: () => {} })
    const started = Date.now()
    try {
      await expect(runMigrations(dead.db, { timeoutMs: 1500, retryMs: 200 })).rejects.toThrow(
        /127\.0\.0\.1:1/,
      )
      const elapsed = Date.now() - started
      expect(elapsed).toBeGreaterThanOrEqual(1200) // it kept retrying
      expect(elapsed).toBeLessThan(4000) // and did not hang
    } finally {
      await dead.close()
    }
  })
})

describe('bin/migrate', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await withTestDb({ migrate: false })
  })
  afterAll(() => t?.drop())

  const run = (env: Record<string, string>) => {
    const started = Date.now()
    const r = spawnSync(process.execPath, [...nodeTsArgs, here('../../bin/migrate.ts')], {
      cwd: apiRoot,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '', MIGRATIONS_DIR: migrationsFolder, ...env },
    })
    return { ...r, elapsed: Date.now() - started }
  }

  it('exits 0 and prints the number applied; a second run applies 0', () => {
    const first = run({ DATABASE_URL: t.url })
    expect(first.stderr).toBe('')
    expect(first.status).toBe(0)
    expect(first.stdout.trim()).toBe(`migrate: applied ${EXPECTED_MIGRATIONS} migration(s)`)
    const second = run({ DATABASE_URL: t.url })
    expect(second.status).toBe(0)
    expect(second.stdout.trim()).toBe('migrate: applied 0 migration(s)')
  })

  it('with an unreachable DATABASE_URL exits non-zero in under timeoutMs + 2 s with one line', () => {
    const r = run({
      DATABASE_URL: 'postgres://mock:mock@127.0.0.1:1/nope',
      MIGRATE_TIMEOUT_MS: '1500',
    })
    expect(r.status).toBe(1)
    expect(r.elapsed).toBeLessThan(1500 + 2000)
    const lines = r.stderr.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^migrate: failed: .*127\.0\.0\.1:1/)
  })

  it('exits 2 when DATABASE_URL is missing', () => {
    const r = run({})
    expect(r.status).toBe(2)
    expect(r.stderr.trim()).toBe('migrate: failed: DATABASE_URL is not set')
  })
})

describe('package manifest', () => {
  it('has no drizzle-kit in runtime dependencies (dev only; ADR 0002)', () => {
    const pkg = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('drizzle-kit')
    expect(Object.keys(pkg.devDependencies ?? {})).toContain('drizzle-kit')
    expect(Object.keys(pkg.dependencies ?? {})).toContain('drizzle-orm')
  })
})

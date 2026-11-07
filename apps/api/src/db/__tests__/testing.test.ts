import { describe, expect, it } from 'vitest'
import { DOCKER_RUN_HINT, redactUrl, withTestDb } from '../testing'

describe('withTestDb', () => {
  it('rejects with an actionable message when Postgres is unreachable (never an undefined error)', async () => {
    const err = await withTestDb({
      adminUrl: 'postgres://mock:topsecret@127.0.0.1:1/postgres',
      connectTimeoutMs: 500,
    }).then(
      () => null,
      (e: Error) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('127.0.0.1:1')
    expect(err!.message).toContain('docker run')
    expect(err!.message).toContain('mockbench-test-pg')
    expect(err!.message).toContain('postgres:16-alpine')
    expect(err!.message).toContain(DOCKER_RUN_HINT)
    expect(err!.message).not.toContain('topsecret') // credentials are redacted
  })

  it('redactUrl hides the password but keeps host and database', () => {
    expect(redactUrl('postgres://mock:pw@db.example:5432/x')).toBe(
      'postgres://mock:***@db.example:5432/x',
    )
  })

  it('returns an isolated, migrated database per call', async () => {
    const a = await withTestDb()
    const b = await withTestDb()
    try {
      expect(a.name).not.toBe(b.name)
      await a.pool.query(`INSERT INTO workspaces (name, slug) VALUES ('A', 'only-in-a')`)
      const inB = await b.pool.query(`SELECT count(*)::int AS n FROM workspaces`)
      expect(inB.rows[0].n).toBe(0)
      const inA = await a.pool.query(`SELECT count(*)::int AS n FROM workspaces`)
      expect(inA.rows[0].n).toBe(1)
    } finally {
      await a.drop()
      await b.drop()
    }
  })

  it('migrate:false gives an empty database', async () => {
    const t = await withTestDb({ migrate: false })
    try {
      const r = await t.pool.query(`SELECT to_regclass('public.users') AS t`)
      expect(r.rows[0].t).toBeNull()
    } finally {
      await t.drop()
    }
  })

  it('drop() is idempotent and really removes the database', async () => {
    const t = await withTestDb({ migrate: false })
    const admin = await withTestDb({ migrate: false })
    try {
      await t.drop()
      await expect(t.drop()).resolves.toBeUndefined()
      const r = await admin.pool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [t.name])
      expect(r.rowCount).toBe(0)
    } finally {
      await admin.drop()
    }
  })
})

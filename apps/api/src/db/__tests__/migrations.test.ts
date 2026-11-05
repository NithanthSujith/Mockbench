import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allTables } from '../schema'
import { createTestDb, migrationsFolder } from './helper'
import type { TestDb } from './helper'

describe('migrations apply from an empty database', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb({ migrate: false })
  })
  afterAll(() => t.drop())

  it('applies every migration to an empty database, and a second run is a no-op', async () => {
    await migrate(t.db, { migrationsFolder })
    const first = await t.one<{ n: string }>(
      'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
    )
    expect(Number(first.n)).toBe(3)

    await migrate(t.db, { migrationsFolder })
    const second = await t.one<{ n: string }>(
      'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
    )
    expect(Number(second.n)).toBe(3)
  })

  it('creates exactly the eleven application tables', async () => {
    const r = await t.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    )
    const names = r.rows.map((x: { table_name: string }) => x.table_name)
    expect(names).toEqual(
      [
        'data_presets',
        'deployments',
        'projects',
        'request_logs',
        'response_cases',
        'routes',
        'sessions',
        'users',
        'versions',
        'workspace_members',
        'workspaces',
      ].sort(),
    )
    expect(Object.keys(allTables)).toHaveLength(11)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './helper'
import type { TestDb } from './helper'

describe('uuid_v7()', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  it('produces version-7, variant-10 UUIDs', async () => {
    const r = await t.pool.query<{ id: string }>(
      'SELECT uuid_v7()::text AS id FROM generate_series(1, 200)',
    )
    for (const { id } of r.rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(200)
  })

  it('values generated 2 ms apart sort ascending as text', async () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = await t.one<{ id: string }>('SELECT uuid_v7()::text AS id')
      ids.push(r.id)
      await t.q('SELECT pg_sleep(0.002)')
    }
    expect([...ids].sort()).toEqual(ids)
  })

  it('encodes the current unix-ms timestamp in the first 48 bits', async () => {
    const r = await t.one<{ delta: string }>(
      `SELECT abs(('x' || substr(replace(uuid_v7()::text, '-', ''), 1, 12))::bit(48)::bigint
                  - floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) AS delta`,
    )
    expect(Number(r.delta)).toBeLessThan(2000)
  })

  it('is the default for every id column', async () => {
    const r = await t.pool.query<{ table_name: string; column_default: string | null }>(
      `SELECT table_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id'`,
    )
    expect(r.rows).toHaveLength(11)
    for (const row of r.rows) expect(row.column_default, row.table_name).toBe('uuid_v7()')
  })
})

describe('set_updated_at()', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const cases: { table: string; make: (t: TestDb) => Promise<string>; set: string }[] = [
    { table: 'users', make: (x) => x.make.user(), set: "name = 'changed'" },
    { table: 'workspaces', make: (x) => x.make.workspace(), set: "name = 'changed'" },
    { table: 'projects', make: (x) => x.make.project(), set: "name = 'changed'" },
    { table: 'routes', make: (x) => x.make.route(), set: "description = 'changed'" },
    { table: 'response_cases', make: (x) => x.make.kase(), set: "name = 'changed'" },
    {
      table: 'data_presets',
      make: async (x) =>
        (
          await x.one<{ id: string }>(
            "INSERT INTO data_presets (project_id, name) VALUES ($1, 'p') RETURNING id",
            [await x.make.project()],
          )
        ).id,
      set: "name = 'changed'",
    },
    {
      table: 'workspace_members',
      make: async (x) =>
        (
          await x.one<{ id: string }>(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'viewer') RETURNING id",
            [await x.make.workspace(), await x.make.user()],
          )
        ).id,
      set: "role = 'editor'",
    },
  ]

  for (const c of cases) {
    it(`advances updated_at on UPDATE of ${c.table}`, async () => {
      const id = await c.make(t)
      const before = await t.one<{ updated_at: Date }>(
        `SELECT updated_at FROM ${c.table} WHERE id = $1`,
        [id],
      )
      await sleep(15)
      await t.q(`UPDATE ${c.table} SET ${c.set} WHERE id = $1`, [id])
      const after = await t.one<{ updated_at: Date }>(
        `SELECT updated_at FROM ${c.table} WHERE id = $1`,
        [id],
      )
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    })
  }

  it('leaves created_at untouched by an UPDATE', async () => {
    const id = await t.make.user()
    const before = await t.one<{ created_at: Date }>('SELECT created_at FROM users WHERE id = $1', [
      id,
    ])
    await t.q("UPDATE users SET name = 'x' WHERE id = $1", [id])
    const after = await t.one<{ created_at: Date }>('SELECT created_at FROM users WHERE id = $1', [
      id,
    ])
    expect(after.created_at.getTime()).toBe(before.created_at.getTime())
  })
})

// Pairs with isolation-a.test.ts (see there).
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withTestDb } from '../testing'
import type { TestDb } from '../testing'

let t: TestDb
beforeAll(async () => {
  t = await withTestDb()
})
afterAll(() => t?.drop())

it('file B sees only its own rows while file A writes concurrently', async () => {
  await t.pool.query(`INSERT INTO workspaces (name, slug) VALUES ('B', 'marker-b')`)
  await new Promise((r) => setTimeout(r, 1500))
  const r = await t.pool.query(`SELECT slug FROM workspaces ORDER BY slug`)
  expect(r.rows.map((x) => x.slug)).toEqual(['marker-b'])
})

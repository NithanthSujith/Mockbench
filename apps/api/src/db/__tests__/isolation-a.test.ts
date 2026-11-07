// Pairs with isolation-b.test.ts: vitest runs the two files in parallel workers; each inserts a
// marker row, waits long enough for the other to have inserted its own, and must see only its own.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withTestDb } from '../testing'
import type { TestDb } from '../testing'

let t: TestDb
beforeAll(async () => {
  t = await withTestDb()
})
afterAll(() => t?.drop())

it('file A sees only its own rows while file B writes concurrently', async () => {
  await t.pool.query(`INSERT INTO workspaces (name, slug) VALUES ('A', 'marker-a')`)
  await new Promise((r) => setTimeout(r, 1500))
  const r = await t.pool.query(`SELECT slug FROM workspaces ORDER BY slug`)
  expect(r.rows.map((x) => x.slug)).toEqual(['marker-a'])
})

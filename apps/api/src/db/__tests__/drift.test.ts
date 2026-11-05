import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from './helper'
import type { TestDb } from './helper'
import { schemaDrift } from './introspect'

describe('drift: Drizzle schema vs migrated database', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb()
  })
  afterAll(() => t.drop())

  it('reports no differences after migrating from empty (columns, indexes, checks, foreign keys)', async () => {
    expect(await schemaDrift(t.pool)).toEqual([])
  })

  it('detects a missing index', async () => {
    await t.q('DROP INDEX routes_project_sort_idx')
    expect(await schemaDrift(t.pool)).toContain(
      'routes: index missing in database: routes_project_sort_idx:plain',
    )
    await t.q('CREATE INDEX routes_project_sort_idx ON routes (project_id, sort_order)')
  })

  it('detects a dropped check constraint', async () => {
    await t.q('ALTER TABLE routes DROP CONSTRAINT routes_method_check')
    expect(await schemaDrift(t.pool)).toContain(
      'routes: check missing in database: routes_method_check',
    )
  })

  it('detects an unexpected column and a changed foreign-key action', async () => {
    await t.q('ALTER TABLE users ADD COLUMN extra text')
    await t.q('ALTER TABLE sessions DROP CONSTRAINT sessions_user_id_users_id_fk')
    await t.q(
      'ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict',
    )
    const diffs = await schemaDrift(t.pool)
    expect(diffs.some((d) => d.startsWith('users: column not in Drizzle schema: extra'))).toBe(true)
    expect(
      diffs.some((d) => d.includes('foreign key') && d.includes('sessions_user_id_users_id_fk')),
    ).toBe(true)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECK_VIOLATION, FK_VIOLATION, UNIQUE_VIOLATION, testDb, pgErrorCode } from './helper'
import type { TestDb } from './helper'

describe('workspaces, members and projects', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  const count = async (table: string, where: string, params: unknown[]) =>
    Number(
      (await t.one<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, params)).n,
    )

  it('workspaces.slug is unique and must match the slug pattern (2-40 chars)', async () => {
    await t.make.workspace('alps')
    expect(await pgErrorCode(t.make.workspace('alps'))).toBe(UNIQUE_VIOLATION)
    for (const bad of ['A', 'Alps', 'a b', '-ab', 'a--b', 'x'.repeat(41)]) {
      expect(await pgErrorCode(t.make.workspace(bad)), bad).toBe(CHECK_VIOLATION)
    }
    expect(await t.make.workspace('ab')).toBeTruthy()
  })

  it('workspace_members is unique on (workspace_id, user_id) and role is an enum', async () => {
    const ws = await t.make.workspace()
    const user = await t.make.user()
    const add = (role: string) =>
      t.q('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
        ws,
        user,
        role,
      ])
    await add('owner')
    expect(await pgErrorCode(add('editor'))).toBe(UNIQUE_VIOLATION)
    const other = await t.make.user()
    expect(
      await pgErrorCode(
        t.q('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
          ws,
          other,
          'admin',
        ]),
      ),
    ).toBe('22P02')
  })

  it('deleting a workspace cascades its memberships but is refused while it has projects', async () => {
    const ws = await t.make.workspace()
    const user = await t.make.user()
    await t.q(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [ws, user],
    )
    await t.make.project({ workspaceId: ws })
    expect(await pgErrorCode(t.q('DELETE FROM workspaces WHERE id = $1', [ws]))).toBe(FK_VIOLATION)
    expect(await count('workspace_members', 'workspace_id = $1', [ws])).toBe(1)

    const empty = await t.make.workspace()
    await t.q(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')",
      [empty, user],
    )
    await t.q('DELETE FROM workspaces WHERE id = $1', [empty])
    expect(await count('workspace_members', 'workspace_id = $1', [empty])).toBe(0)
  })

  it('project slugs Api, ab, a--b are rejected by check; a-b is accepted', async () => {
    for (const bad of ['Api', 'ab', 'a--b', '-ab', 'ab-', 'a_b', 'x'.repeat(41)]) {
      expect(await pgErrorCode(t.make.project({ slug: bad })), bad).toBe(CHECK_VIOLATION)
    }
    expect(await t.make.project({ slug: 'a-b' })).toBeTruthy()
    expect(await t.make.project({ slug: 'x'.repeat(40) })).toBeTruthy()
  })

  it('project slug is globally unique, across workspaces', async () => {
    await t.make.project({ slug: 'billing-api' })
    expect(await pgErrorCode(t.make.project({ slug: 'billing-api' }))).toBe(UNIQUE_VIOLATION)
  })

  it('projects get default settings, components, version_seq and no active version', async () => {
    const id = await t.make.project()
    const r = await t.one<{
      settings: unknown
      components: unknown
      version_seq: number
      active_version_id: string | null
    }>('SELECT settings, components, version_seq, active_version_id FROM projects WHERE id = $1', [
      id,
    ])
    expect(r.settings).toEqual({})
    expect(r.components).toEqual({})
    expect(r.version_seq).toBe(0)
    expect(r.active_version_id).toBeNull()
  })

  it('deleting a project cascades to routes, cases, presets, versions, deployments, request_logs', async () => {
    const p = await t.make.project()
    const route = await t.make.route({ projectId: p })
    await t.make.kase({ routeId: route, isDefault: true })
    await t.q("INSERT INTO data_presets (project_id, name) VALUES ($1, 'x')", [p])
    const v = await t.make.version({ projectId: p })
    await t.q(
      "INSERT INTO deployments (project_id, version_id, version_label) VALUES ($1, $2, 'v1')",
      [p, v],
    )
    // a request log referencing the version would RESTRICT a bare version delete, but a project delete
    // removes logs and versions together
    await t.q(
      "INSERT INTO request_logs (project_id, version_id, method, path, status_code, duration_ms) VALUES ($1, $2, 'GET', '/', 200, 1)",
      [p, v],
    )
    await t.q('DELETE FROM projects WHERE id = $1', [p])
    expect(await count('routes', 'project_id = $1', [p])).toBe(0)
    expect(await count('response_cases', 'route_id = $1', [route])).toBe(0)
    expect(await count('data_presets', 'project_id = $1', [p])).toBe(0)
    expect(await count('versions', 'project_id = $1', [p])).toBe(0)
    expect(await count('deployments', 'project_id = $1', [p])).toBe(0)
    expect(await count('request_logs', 'project_id = $1', [p])).toBe(0)
  })

  it('deleting the active version sets projects.active_version_id to NULL', async () => {
    const p = await t.make.project()
    const v = await t.make.version({ projectId: p })
    await t.q('UPDATE projects SET active_version_id = $1 WHERE id = $2', [v, p])
    await t.q('DELETE FROM versions WHERE id = $1', [v])
    const r = await t.one<{ active_version_id: string | null }>(
      'SELECT active_version_id FROM projects WHERE id = $1',
      [p],
    )
    expect(r.active_version_id).toBeNull()
  })

  it('data_presets default to enabled, priority 0 and an empty rule list', async () => {
    const p = await t.make.project()
    const r = await t.one<{ is_enabled: boolean; priority: number; rules: unknown }>(
      "INSERT INTO data_presets (project_id, name) VALUES ($1, 'x') RETURNING is_enabled, priority, rules",
      [p],
    )
    expect(r).toEqual({ is_enabled: true, priority: 0, rules: [] })
  })
})

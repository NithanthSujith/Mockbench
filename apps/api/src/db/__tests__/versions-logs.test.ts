import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FK_VIOLATION,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
  createTestDb,
  pgErrorCode,
} from './helper'
import type { TestDb } from './helper'

describe('versions, deployments and request_logs', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb()
  })
  afterAll(() => t.drop())

  const count = async (table: string, where: string, params: unknown[]) =>
    Number(
      (await t.one<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, params)).n,
    )

  it('UPDATE versions raises whatever the column (label, snapshot, baked, notes)', async () => {
    const v = await t.make.version()
    for (const set of [
      `label = 'x'`,
      `snapshot = '{"a":1}'`,
      `baked = 'x'`,
      `notes = 'n'`,
      `seq = 99`,
    ]) {
      expect(await pgErrorCode(t.q(`UPDATE versions SET ${set} WHERE id = $1`, [v])), set).toBe(
        RESTRICT_VIOLATION,
      )
    }
    const r = await t.one<{ label: string }>('SELECT label FROM versions WHERE id = $1', [v])
    expect(r.label).toBe('v1')
  })

  it('UPDATE versions raises even for a superuser connection, and for a no-op assignment', async () => {
    const v = await t.make.version()
    // the connection role is a superuser; immutability must not depend on grants
    const who = await t.one<{ su: string }>("SELECT current_setting('is_superuser') AS su")
    expect(who.su).toBe('on')
    expect(await pgErrorCode(t.q('UPDATE versions SET label = label WHERE id = $1', [v]))).toBe(
      RESTRICT_VIOLATION,
    )
  })

  it('DELETE of an inactive, unreferenced version succeeds', async () => {
    const v = await t.make.version()
    await t.q('DELETE FROM versions WHERE id = $1', [v])
    expect(await count('versions', 'id = $1', [v])).toBe(0)
  })

  it('deleting the user who created a version nulls created_by (the one permitted change)', async () => {
    const user = await t.make.user()
    const v = await t.make.version({ createdBy: user })
    await t.q('DELETE FROM users WHERE id = $1', [user])
    const r = await t.one<{ created_by: string | null; label: string }>(
      'SELECT created_by, label FROM versions WHERE id = $1',
      [v],
    )
    expect(r.created_by).toBeNull()
    expect(r.label).toBe('v1')
  })

  it('seq and label are unique per project and may repeat across projects', async () => {
    const p1 = await t.make.project()
    const p2 = await t.make.project()
    await t.make.version({ projectId: p1, seq: 1, label: 'first' })
    expect(await pgErrorCode(t.make.version({ projectId: p1, seq: 1, label: 'other' }))).toBe(
      UNIQUE_VIOLATION,
    )
    expect(await pgErrorCode(t.make.version({ projectId: p1, seq: 2, label: 'first' }))).toBe(
      UNIQUE_VIOLATION,
    )
    expect(await t.make.version({ projectId: p2, seq: 1, label: 'first' })).toBeTruthy()
  })

  it('has no updated_at column on versions, deployments and request_logs', async () => {
    const r = await t.pool.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'updated_at'
         AND table_name IN ('versions', 'deployments', 'request_logs')`,
    )
    expect(r.rows).toEqual([])
  })

  it('baked_bytes defaults to 0 and baked may be NULL (random mode)', async () => {
    const v = await t.make.version()
    const r = await t.one<{ baked: string | null; baked_bytes: number }>(
      'SELECT baked, baked_bytes FROM versions WHERE id = $1',
      [v],
    )
    expect(r).toEqual({ baked: null, baked_bytes: 0 })
  })

  it('deleting a version referenced by a request_logs row fails 23503; once unreferenced it succeeds', async () => {
    const p = await t.make.project()
    const v = await t.make.version({ projectId: p })
    await t.q(
      "INSERT INTO request_logs (project_id, version_id, method, path, status_code, duration_ms) VALUES ($1, $2, 'GET', '/x', 200, 3)",
      [p, v],
    )
    expect(await pgErrorCode(t.q('DELETE FROM versions WHERE id = $1', [v]))).toBe(FK_VIOLATION)
    await t.q('DELETE FROM request_logs WHERE version_id = $1', [v])
    await t.q('DELETE FROM versions WHERE id = $1', [v])
    expect(await count('versions', 'id = $1', [v])).toBe(0)
  })

  it('deleting a version referenced only by deployments succeeds; version_id becomes NULL, version_label stays', async () => {
    const p = await t.make.project()
    const v = await t.make.version({ projectId: p, label: 'v7' })
    const d = await t.one<{ id: string }>(
      "INSERT INTO deployments (project_id, version_id, version_label) VALUES ($1, $2, 'v7') RETURNING id",
      [p, v],
    )
    await t.q('DELETE FROM versions WHERE id = $1', [v])
    const r = await t.one<{ version_id: string | null; version_label: string }>(
      'SELECT version_id, version_label FROM deployments WHERE id = $1',
      [d.id],
    )
    expect(r).toEqual({ version_id: null, version_label: 'v7' })
  })

  it('deployments.deployed_by is nulled when the user is deleted', async () => {
    const p = await t.make.project()
    const user = await t.make.user()
    const d = await t.one<{ id: string }>(
      "INSERT INTO deployments (project_id, version_label, deployed_by) VALUES ($1, 'v1', $2) RETURNING id",
      [p, user],
    )
    await t.q('DELETE FROM users WHERE id = $1', [user])
    const r = await t.one<{ deployed_by: string | null }>(
      'SELECT deployed_by FROM deployments WHERE id = $1',
      [d.id],
    )
    expect(r.deployed_by).toBeNull()
  })

  it('deleting a route succeeds when a request_logs row holds its id in matched_route_id', async () => {
    const p = await t.make.project()
    const route = await t.make.route({ projectId: p })
    const kase = await t.make.kase({ routeId: route, isDefault: true })
    await t.q(
      `INSERT INTO request_logs (project_id, method, path, matched_route_id, matched_case_id, route_pattern, case_name, status_code, duration_ms)
       VALUES ($1, 'GET', '/x', $2, $3, 'GET /x', 'OK', 200, 2)`,
      [p, route, kase],
    )
    await t.q('DELETE FROM routes WHERE id = $1', [route])
    const r = await t.one<{ matched_route_id: string; route_pattern: string }>(
      'SELECT matched_route_id, route_pattern FROM request_logs WHERE project_id = $1',
      [p],
    )
    expect(r.matched_route_id).toBe(route)
    expect(r.route_pattern).toBe('GET /x')
  })

  it('request_logs accept an unpublished project (no version), mock_error rows and JSON defaults', async () => {
    const p = await t.make.project()
    const r = await t.one<{ version_id: string | null; request_headers: unknown; query: unknown }>(
      `INSERT INTO request_logs (project_id, method, path, status_code, duration_ms, mock_error)
       VALUES ($1, 'GET', '/x', 503, 1, 'project_not_published') RETURNING version_id, request_headers, query`,
      [p],
    )
    expect(r).toEqual({ version_id: null, request_headers: {}, query: {} })
  })
})

// RUN-08: one test per backend acceptance criterion in docs/specs/RUN-08-request-log-api-screen.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { requestLogs } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())

type Seed = Partial<typeof requestLogs.$inferInsert>
const base = Date.parse('2026-01-01T12:00:00.000Z')

async function world() {
  const ws = await t.f.createWorkspace()
  const viewer = await t.f.createMember({ workspaceId: ws.id, role: 'viewer' })
  const session = await t.session(viewer.userId)
  const outsider = await t.session()
  const project = await t.f.createProject({ workspaceId: ws.id })
  return { ws, session, outsider, project }
}

async function seed(projectId: string, rows: Seed[]) {
  await t.db.insert(requestLogs).values(
    rows.map((r, i) => ({
      projectId,
      method: 'GET',
      path: '/x',
      statusCode: 200,
      durationMs: 3,
      createdAt: new Date(base + i * 1000),
      ...r,
    })),
  )
}

const get = (w: Awaited<ReturnType<typeof world>>, qs = '', who = w.session) =>
  t.as(who).get(`/api/v1/projects/${w.project.id}/requests${qs}`)

describe('requests.list', () => {
  it('returns newest first and pages 50/50/20 over 120 rows', async () => {
    const w = await world()
    await seed(
      w.project.id,
      Array.from({ length: 120 }, (_, i) => ({ path: `/r/${i}` })),
    )
    const p1 = await get(w)
    expect(p1.status).toBe(200)
    t.assertContract('requests.list', p1)
    expect(p1.body.items).toHaveLength(50)
    expect(p1.body.items[0].path).toBe('/r/119')
    const p2 = await get(w, `?cursor=${p1.body.nextCursor}`)
    expect(p2.body.items).toHaveLength(50)
    expect(p2.body.items[0].path).toBe('/r/69')
    const p3 = await get(w, `?cursor=${p2.body.nextCursor}`)
    expect(p3.body.items).toHaveLength(20)
    expect(p3.body.nextCursor).toBeNull()
  })

  it('limit=201 is 422 and a tampered cursor is 400 invalid_cursor', async () => {
    const w = await world()
    expect((await get(w, '?limit=201')).status).toBe(422)
    const bad = await get(w, '?cursor=not-a-cursor')
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_cursor')
  })

  it('filters AND together', async () => {
    const w = await world()
    await seed(w.project.id, [
      { statusCode: 200, path: '/invoices/1' },
      { statusCode: 404, path: '/Invoices/9', method: 'POST' },
      { statusCode: 404, path: '/payments', mockError: 'route_not_found' },
      { statusCode: 500, path: '/invoices/2' },
      { statusCode: 422, path: '/100%_done' },
    ])
    const paths = async (qs: string) =>
      (await get(w, qs)).body.items.map((i: { path: string }) => i.path).sort()
    expect(await paths('?status=4xx')).toEqual(['/100%_done', '/Invoices/9', '/payments'])
    expect(await paths('?status=404')).toEqual(['/Invoices/9', '/payments'])
    expect(await paths('?method=POST')).toEqual(['/Invoices/9'])
    expect(await paths('?path=invoices')).toEqual(['/Invoices/9', '/invoices/1', '/invoices/2'])
    expect(await paths('?path=%25_')).toEqual(['/100%_done'])
    expect(await paths('?mockError=true')).toEqual(['/payments'])
    expect(await paths('?status=404&path=invoices')).toEqual(['/Invoices/9'])
    expect(
      await paths(`?since=${encodeURIComponent(new Date(base + 3000).toISOString())}`),
    ).toEqual(['/100%_done', '/invoices/2'])
  })

  it('includes versionLabel (null when the version is gone), stored headers and ip', async () => {
    const w = await world()
    const v = await t.f.createVersion({ projectId: w.project.id })
    await seed(w.project.id, [
      {
        versionId: v.id,
        ip: '192.168.1.5',
        requestHeaders: { authorization: '[redacted]', accept: '*/*' },
        query: { a: '1', b: ['x', 'y'] },
      },
      { versionId: null },
    ])
    const items = (await get(w)).body.items
    expect(items[1]).toMatchObject({
      versionLabel: v.label,
      versionId: v.id,
      ip: '192.168.1.5',
      requestHeaders: { authorization: '[redacted]', accept: '*/*' },
      query: { a: '1', b: ['x', 'y'] },
    })
    expect(items[0].versionLabel).toBeNull()
  })

  it('viewer can read, non-member gets 404, other projects are not mixed in', async () => {
    const w = await world()
    const other = await t.f.createProject({ workspaceId: w.ws.id })
    await seed(w.project.id, [{ path: '/mine' }])
    await seed(other.id, [{ path: '/theirs' }])
    const ok = await get(w)
    expect(ok.status).toBe(200)
    expect(ok.body.items.map((i: { path: string }) => i.path)).toEqual(['/mine'])
    expect((await get(w, '', w.outsider)).status).toBe(404)
  })
})

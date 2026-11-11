// RUN-02: one test per acceptance criterion in docs/specs/RUN-02-publish-versions-api.md.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projects, requestLogs, responseCases, versions } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'

type Role = 'owner' | 'editor' | 'viewer'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())

/** A project (with `routes` plain routes) plus one session per role and an outsider. */
async function world(routeCount = 1) {
  const ws = await t.f.createWorkspace()
  const people = {} as Record<Role | 'outsider', TestSession & { userId: string }>
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const m = await t.f.createMember({ workspaceId: ws.id, role })
    people[role] = { ...(await t.session(m.userId)), userId: m.userId }
  }
  people.outsider = { ...(await t.session()), userId: '' }
  const project = await t.f.createProject({ workspaceId: ws.id })
  for (let i = 0; i < routeCount; i++) {
    await t.f.createRoute({ projectId: project.id, path: `/r${i}` })
  }
  return { ws, project, ...people }
}

const seqOf = async (projectId: string) =>
  (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!.versionSeq
const versionRows = (projectId: string) =>
  t.db.select().from(versions).where(eq(versions.projectId, projectId))

const publish = (w: { editor: TestSession; project: { id: string } }, body: object = {}) =>
  t.as(w.editor).post(`/api/v1/projects/${w.project.id}/versions`).send(body)

describe('versions.publish', () => {
  it('first publish: 201, seq 1, label v1, not active, counts populated, active_version_id untouched', async () => {
    const w = await world(2)
    const res = await publish(w)
    expect(res.status).toBe(201)
    t.assertContract('versions.publish', res)
    expect(res.body).toMatchObject({
      projectId: w.project.id,
      seq: 1,
      label: 'v1',
      isActive: false,
      notes: null,
      createdBy: { id: w.editor.userId },
      routeCount: 2,
      caseCount: 2,
    })
    expect(res.body.bakedBytes).toBeGreaterThan(0)
    const [p] = await t.db.select().from(projects).where(eq(projects.id, w.project.id))
    expect(p!.activeVersionId).toBeNull()
  })

  it('stores a custom label and notes; a duplicate label is 409 with no row and no seq consumed; another project may reuse it', async () => {
    const w = await world()
    const label = 'before-the-pricing-change'
    const ok = await publish(w, { label, notes: 'snapshot before pricing' })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ label, notes: 'snapshot before pricing' })

    const dup = await publish(w, { label })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toBe('label_taken')
    t.assertContract('versions.publish', dup)
    expect(await versionRows(w.project.id)).toHaveLength(1)
    expect(await seqOf(w.project.id)).toBe(1)

    const other = await world()
    expect((await publish(other, { label })).status).toBe(201)
  })

  it('after deleting the latest version, the next publish gets previous max + 1 (never reuses)', async () => {
    const w = await world()
    await publish(w)
    const second = await publish(w)
    expect(second.body.seq).toBe(2)
    const del = await t.as(w.editor).delete(`/api/v1/versions/${second.body.id}`)
    expect(del.status).toBe(204)
    const third = await publish(w)
    expect(third.body).toMatchObject({ seq: 3, label: 'v3' })
  })

  it('two simultaneous publishes yield distinct seq values and both 201', async () => {
    const w = await world(3)
    const results = await Promise.all([publish(w), publish(w), publish(w), publish(w)])
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201])
    const seqs = results.map((r) => r.body.seq as number).sort()
    expect(seqs).toEqual([1, 2, 3, 4])
    expect(await seqOf(w.project.id)).toBe(4)
  })

  it('an invalid case: 422 publish_invalid naming route, case and issues; no row, seq unchanged', async () => {
    const w = await world()
    const route = await t.f.createRoute({ projectId: w.project.id, path: '/bad' })
    await t.db
      .update(responseCases)
      .set({
        schema: {
          version: 1,
          components: {},
          root: { type: 'object', fields: [{ key: 'a', node: { type: 'ref', name: 'Nope' } }] },
        },
      })
      .where(eq(responseCases.routeId, route.id))
    const res = await publish(w)
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('publish_invalid')
    t.assertContract('versions.publish', res)
    expect(res.body.details).toHaveLength(1)
    expect(res.body.details[0]).toMatchObject({
      routeId: route.id,
      method: 'GET',
      path: '/bad',
      caseName: 'OK',
    })
    expect(res.body.details[0].issues.map((i: { code: string }) => i.code)).toContain('unknown_ref')
    expect(await versionRows(w.project.id)).toHaveLength(0)
    expect(await seqOf(w.project.id)).toBe(0)
  })

  it('a project with zero routes: 422 empty_project', async () => {
    const w = await world(0)
    const res = await publish(w)
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('empty_project')
    expect(await seqOf(w.project.id)).toBe(0)
  })

  it('label validation: 81 characters or only whitespace is 422', async () => {
    const w = await world()
    expect((await publish(w, { label: 'x'.repeat(81) })).status).toBe(422)
    expect((await publish(w, { label: '   ' })).status).toBe(422)
    expect((await publish(w, { label: 'x'.repeat(80) })).status).toBe(201)
  })

  it('role matrix: viewer 403, non-member 404, owner and editor 201', async () => {
    const w = await world()
    const url = `/api/v1/projects/${w.project.id}/versions`
    expect((await t.as(w.viewer).post(url).send({})).status).toBe(403)
    expect((await t.as(w.outsider).post(url).send({})).status).toBe(404)
    expect((await t.as(w.owner).post(url).send({})).status).toBe(201)
    expect((await t.as(w.editor).post(url).send({})).status).toBe(201)
    expect(await versionRows(w.project.id)).toHaveLength(2)
  })

  it('draft changes after publishing do not change the version snapshot', async () => {
    const w = await world()
    const pub = await publish(w)
    await t.f.createRoute({ projectId: w.project.id, path: '/added-later' })
    await t.db
      .update(projects)
      .set({ settings: { indexing: 'local', mode: 'seeded', cors: 'off', defaultDelayMs: 5 } })
      .where(eq(projects.id, w.project.id))
    const got = await t.as(w.viewer).get(`/api/v1/versions/${pub.body.id}`)
    expect(got.body.snapshot).toEqual(pub.body.snapshot)
    expect(got.body.snapshot.routes).toHaveLength(1)
  })
})

describe('versions.list', () => {
  it('is newest first, paginates 2,2,1, and carries no snapshot or baked', async () => {
    const w = await world()
    for (let i = 0; i < 5; i++) expect((await publish(w)).status).toBe(201)
    const url = `/api/v1/projects/${w.project.id}/versions`
    const p1 = await t.as(w.viewer).get(`${url}?limit=2`)
    t.assertContract('versions.list', p1)
    const p2 = await t.as(w.viewer).get(`${url}?limit=2&cursor=${p1.body.nextCursor}`)
    const p3 = await t.as(w.viewer).get(`${url}?limit=2&cursor=${p2.body.nextCursor}`)
    expect([p1, p2, p3].map((p) => p.body.items.length)).toEqual([2, 2, 1])
    expect(p3.body.nextCursor).toBeNull()
    const seqs = [p1, p2, p3].flatMap((p) => p.body.items.map((v: { seq: number }) => v.seq))
    expect(seqs).toEqual([5, 4, 3, 2, 1])
    const text = JSON.stringify([p1.body, p2.body, p3.body])
    expect(text).not.toContain('"snapshot"')
    expect(text).not.toContain('"baked"')
    expect(text.length).toBeLessThan(5000)
  })

  it('a bad cursor is 400 invalid_cursor; non-member is 404', async () => {
    const w = await world()
    const url = `/api/v1/projects/${w.project.id}/versions`
    const bad = await t.as(w.viewer).get(`${url}?cursor=nope`)
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_cursor')
    expect((await t.as(w.outsider).get(url)).status).toBe(404)
  })

  it('reports isActive for the active version', async () => {
    const w = await world()
    const pub = await publish(w)
    await t.db
      .update(projects)
      .set({ activeVersionId: pub.body.id })
      .where(eq(projects.id, w.project.id))
    const res = await t.as(w.viewer).get(`/api/v1/projects/${w.project.id}/versions`)
    expect(res.body.items[0].isActive).toBe(true)
  })
})

describe('versions.get', () => {
  it('returns the full snapshot and never baked', async () => {
    const w = await world()
    const pub = await publish(w)
    const res = await t.as(w.viewer).get(`/api/v1/versions/${pub.body.id}`)
    expect(res.status).toBe(200)
    t.assertContract('versions.get', res)
    expect(res.body.snapshot.routes).toHaveLength(1)
    expect(res.body).not.toHaveProperty('baked')
    expect((await t.as(w.outsider).get(`/api/v1/versions/${pub.body.id}`)).status).toBe(404)
  })
})

describe('versions.delete', () => {
  it('active -> 409 version_active; referenced by a request log -> 409 version_referenced; else 204; viewer 403', async () => {
    const w = await world()
    const a = (await publish(w)).body
    const b = (await publish(w)).body
    const c = (await publish(w)).body

    await t.db.update(projects).set({ activeVersionId: a.id }).where(eq(projects.id, w.project.id))
    const active = await t.as(w.editor).delete(`/api/v1/versions/${a.id}`)
    expect(active.status).toBe(409)
    expect(active.body.error).toBe('version_active')

    await t.db.insert(requestLogs).values({
      projectId: w.project.id,
      versionId: b.id,
      method: 'GET',
      path: '/r0',
      statusCode: 200,
      durationMs: 1,
    })
    const ref = await t.as(w.editor).delete(`/api/v1/versions/${b.id}`)
    expect(ref.status).toBe(409)
    expect(ref.body.error).toBe('version_referenced')

    expect((await t.as(w.viewer).delete(`/api/v1/versions/${c.id}`)).status).toBe(403)
    expect((await t.as(w.outsider).delete(`/api/v1/versions/${c.id}`)).status).toBe(404)
    const ok = await t.as(w.editor).delete(`/api/v1/versions/${c.id}`)
    expect(ok.status).toBe(204)
    expect((await versionRows(w.project.id)).map((v) => v.seq).sort()).toEqual([1, 2])
  })
})

describe('immutability', () => {
  it('a raw-SQL UPDATE on a version row fails (trigger)', async () => {
    const w = await world()
    const pub = await publish(w)
    await expect(
      t.db.update(versions).set({ label: 'tampered' }).where(eq(versions.id, pub.body.id)),
    ).rejects.toThrow()
    const [row] = await t.db.select().from(versions).where(eq(versions.id, pub.body.id))
    expect(row!.label).toBe('v1')
  })
})

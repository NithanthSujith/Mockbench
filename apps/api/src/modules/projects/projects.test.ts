// PRJ-01: one test (or table) per acceptance criterion in docs/specs/PRJ-01-projects-api.md.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHooks } from '../../http/hooks'
import { projects } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'

type Role = 'owner' | 'editor' | 'viewer'

let t: TestApp
const hooks = createHooks()

beforeAll(async () => {
  t = await testApp({ deps: { hooks } })
})
afterAll(() => t.drop())

/** A workspace with one member per role, plus an outsider who belongs to nothing. */
async function world() {
  const ws = await t.f.createWorkspace()
  const people = {} as Record<Role | 'outsider', TestSession>
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const m = await t.f.createMember({ workspaceId: ws.id, role })
    people[role] = await t.session(m.userId)
  }
  people.outsider = await t.session()
  return { ws, ...people }
}

const projectCount = async () =>
  Number((await t.db.select({ n: sql<number>`count(*)::int` }).from(projects))[0]!.n)

describe('projects.create', () => {
  it('creates a project: 201, contract-shaped, default settings and zero counts', async () => {
    const w = await world()
    const res = await t
      .as(w.editor)
      .post('/api/v1/projects')
      .send({ workspaceId: w.ws.id, name: 'Billing API', slug: 'billing-api' })
    expect(res.status).toBe(201)
    t.assertContract('projects.create', res)
    expect(res.body).toMatchObject({
      workspaceId: w.ws.id,
      name: 'Billing API',
      slug: 'billing-api',
      description: null,
      settings: { indexing: 'local', mode: 'deterministic', cors: '*', defaultDelayMs: 0 },
      components: {},
      activeVersion: null,
      routeCount: 0,
      caseCount: 0,
    })
  })

  it('keeps the other defaults when only some settings are sent', async () => {
    const w = await world()
    const res = await t
      .as(w.editor)
      .post('/api/v1/projects')
      .send({
        workspaceId: w.ws.id,
        name: 'Seeded',
        slug: `seeded-${Date.now()}`,
        settings: { mode: 'seeded' },
      })
    expect(res.status).toBe(201)
    expect(res.body.settings).toEqual({
      indexing: 'local',
      mode: 'seeded',
      cors: '*',
      defaultDelayMs: 0,
    })
  })

  it('a taken slug is 409 slug_taken, even from another workspace, and creates no row', async () => {
    const a = await world()
    const b = await world()
    const slug = `shared-${Date.now()}`
    expect(
      (
        await t
          .as(a.editor)
          .post('/api/v1/projects')
          .send({ workspaceId: a.ws.id, name: 'A', slug })
      ).status,
    ).toBe(201)
    const before = await projectCount()
    const res = await t
      .as(b.editor)
      .post('/api/v1/projects')
      .send({ workspaceId: b.ws.id, name: 'B', slug })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('slug_taken')
    t.assertContract('projects.create', res)
    expect(await projectCount()).toBe(before)
  })

  it.each(['api', 'mock', 'health', 'static', 'assets', 'admin'])(
    'reserved slug %s is 422 slug_reserved and creates no row',
    async (slug) => {
      const w = await world()
      const before = await projectCount()
      const res = await t
        .as(w.editor)
        .post('/api/v1/projects')
        .send({ workspaceId: w.ws.id, name: 'Reserved', slug })
      expect(res.status).toBe(422)
      expect(res.body.error).toBe('slug_reserved')
      t.assertContract('projects.create', res)
      expect(await projectCount()).toBe(before)
    },
  )

  it.each([
    ['uppercase', 'Billing'],
    ['too short', 'ab'],
    ['double hyphen', 'a--b'],
    ['41 characters', 'a'.repeat(41)],
    ['underscore', 'a_b'],
    ['leading hyphen', '-abc'],
  ])('a malformed slug (%s) is 422 validation_failed and creates no row', async (_n, slug) => {
    const w = await world()
    const before = await projectCount()
    const res = await t
      .as(w.editor)
      .post('/api/v1/projects')
      .send({ workspaceId: w.ws.id, name: 'Bad', slug })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
    expect(await projectCount()).toBe(before)
  })

  it('role matrix: viewer 403, outsider 404, signed-out 401, editor and owner 201', async () => {
    const w = await world()
    const post = (s: TestSession | undefined, slug: string) =>
      t.as(s).post('/api/v1/projects').send({ workspaceId: w.ws.id, name: 'Matrix', slug })
    const stamp = Date.now()
    expect((await post(w.viewer, `m-viewer-${stamp}`)).status).toBe(403)
    expect((await post(w.outsider, `m-out-${stamp}`)).status).toBe(404)
    expect((await post(undefined, `m-anon-${stamp}`)).status).toBe(401)
    expect((await post(w.editor, `m-editor-${stamp}`)).status).toBe(201)
    expect((await post(w.owner, `m-owner-${stamp}`)).status).toBe(201)
  })
})

describe('projects.update', () => {
  async function fresh() {
    const w = await world()
    const p = await t.f.createProject({ workspaceId: w.ws.id, name: 'Before' })
    return { w, p, url: `/api/v1/projects/${p.id}` }
  }

  it('settings merge per key: only the keys sent change', async () => {
    const { w, url } = await fresh()
    const res = await t
      .as(w.editor)
      .patch(url)
      .send({ settings: { mode: 'random' } })
    expect(res.status).toBe(200)
    t.assertContract('projects.update', res)
    expect(res.body.settings).toEqual({
      indexing: 'local',
      mode: 'random',
      cors: '*',
      defaultDelayMs: 0,
    })
    const again = await t
      .as(w.editor)
      .patch(url)
      .send({ settings: { defaultDelayMs: 250 } })
    expect(again.body.settings).toEqual({
      indexing: 'local',
      mode: 'random',
      cors: '*',
      defaultDelayMs: 250,
    })
  })

  it('slug and workspaceId are read-only: 422 with issue code read_only', async () => {
    const { w, url } = await fresh()
    for (const body of [{ slug: 'x-new' }, { workspaceId: w.ws.id }]) {
      const res = await t.as(w.editor).patch(url).send(body)
      expect(res.status).toBe(422)
      expect(res.body.error).toBe('validation_failed')
      expect(res.body.details.map((d: { code: string }) => d.code)).toContain('read_only')
    }
  })

  it('name cannot be null; description can be cleared; unknown keys are rejected', async () => {
    const { w, p, url } = await fresh()
    expect((await t.as(w.editor).patch(url).send({ name: null })).status).toBe(422)
    await t.db.execute(sql`update projects set description = 'x' where id = ${p.id}`)
    const cleared = await t.as(w.editor).patch(url).send({ description: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.description).toBeNull()
    expect((await t.as(w.editor).patch(url).send({ nope: 1 })).status).toBe(422)
  })

  it('`{}` is a no-op: 200 and updatedAt does not move; a real change moves it', async () => {
    const { w, url } = await fresh()
    const before = (await t.as(w.editor).get(url)).body
    const noop = await t.as(w.editor).patch(url).send({})
    expect(noop.status).toBe(200)
    expect(noop.body.updatedAt).toBe(before.updatedAt)
    await new Promise((r) => setTimeout(r, 10))
    const changed = await t.as(w.editor).patch(url).send({ name: 'After' })
    expect(changed.body.name).toBe('After')
    expect(changed.body.updatedAt > before.updatedAt).toBe(true)
  })

  it('role matrix: viewer 403, outsider 404, editor 200', async () => {
    const { w, url } = await fresh()
    expect((await t.as(w.viewer).patch(url).send({ name: 'V' })).status).toBe(403)
    expect((await t.as(w.outsider).patch(url).send({ name: 'O' })).status).toBe(404)
    expect((await t.as(w.editor).patch(url).send({ name: 'E' })).status).toBe(200)
  })

  describe('components', () => {
    const user = {
      type: 'object',
      fields: [
        { key: 'id', node: { type: 'uuid' } },
        { key: 'name', node: { type: 'string' } },
      ],
    }

    it('replaces the whole components object', async () => {
      const { w, url } = await fresh()
      const one = await t
        .as(w.editor)
        .patch(url)
        .send({ components: { User: user } })
      expect(one.status).toBe(200)
      t.assertContract('projects.update', one)
      expect(Object.keys(one.body.components)).toEqual(['User'])
      const two = await t
        .as(w.editor)
        .patch(url)
        .send({ components: { Order: { type: 'integer' } } })
      expect(Object.keys(two.body.components)).toEqual(['Order'])
    })

    it('an invalid component is 422 with the schema-core issue path and code', async () => {
      const { w, url } = await fresh()
      const res = await t
        .as(w.editor)
        .patch(url)
        .send({ components: { Bad: { type: 'enum', values: [] } } })
      expect(res.status).toBe(422)
      expect(res.body.details[0]).toMatchObject({ code: 'enum_empty' })
      expect(res.body.details[0].path.slice(0, 2)).toEqual(['components', 'Bad'])
    })

    it('a component cycle is rejected (ref_cycle)', async () => {
      const { w, url } = await fresh()
      const res = await t
        .as(w.editor)
        .patch(url)
        .send({
          components: {
            A: { type: 'object', fields: [{ key: 'b', node: { type: 'ref', name: 'B' } }] },
            B: { type: 'object', fields: [{ key: 'a', node: { type: 'ref', name: 'A' } }] },
          },
        })
      expect(res.status).toBe(422)
      expect(res.body.details.map((d: { code: string }) => d.code)).toContain('ref_cycle')
    })

    it('removing a component a stored case still references is 422 component_in_use, and changes nothing', async () => {
      const { w, p, url } = await fresh()
      await t
        .as(w.editor)
        .patch(url)
        .send({ components: { User: user } })
      const route = await t.f.createRoute({ projectId: p.id, method: 'GET', path: '/users' })
      await t.f.createCase({
        routeId: route.id,
        name: 'Uses ref',
        statusCode: 200,
        schema: {
          version: 1,
          components: {},
          root: { type: 'object', fields: [{ key: 'u', node: { type: 'ref', name: 'User' } }] },
        },
      })

      const blocked = await t.as(w.editor).patch(url).send({ components: {} })
      expect(blocked.status).toBe(422)
      expect(blocked.body.error).toBe('validation_failed')
      expect(blocked.body.details[0]).toMatchObject({
        code: 'component_in_use',
        path: ['components', 'User'],
      })
      expect(blocked.body.details[0].message).toContain('GET /users')
      const after = (await t.as(w.editor).get(url)).body
      expect(Object.keys(after.components)).toEqual(['User'])

      // Keeping the component (even edited) is fine.
      const ok = await t
        .as(w.editor)
        .patch(url)
        .send({ components: { User: { type: 'string' } } })
      expect(ok.status).toBe(200)
    })
  })
})

describe('projects.list', () => {
  it('requires workspaceId (422); an outsider gets 404; every member role can read', async () => {
    const w = await world()
    await t.f.createProject({ workspaceId: w.ws.id })
    expect((await t.as(w.viewer).get('/api/v1/projects')).status).toBe(422)
    const url = `/api/v1/projects?workspaceId=${w.ws.id}`
    expect((await t.as(w.outsider).get(url)).status).toBe(404)
    expect((await t.as(undefined).get(url)).status).toBe(401)
    for (const role of ['viewer', 'editor', 'owner'] as const) {
      const res = await t.as(w[role]).get(url)
      expect(res.status).toBe(200)
      t.assertContract('projects.list', res)
      expect(res.body.items).toHaveLength(1)
    }
  })

  it('only lists the requested workspace, oldest first', async () => {
    const w = await world()
    const other = await t.f.createWorkspace()
    await t.f.createProject({ workspaceId: other.id, name: 'Elsewhere' })
    const first = await t.f.createProject({ workspaceId: w.ws.id, name: 'First' })
    const second = await t.f.createProject({ workspaceId: w.ws.id, name: 'Second' })
    const res = await t.as(w.viewer).get(`/api/v1/projects?workspaceId=${w.ws.id}`)
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([first.id, second.id])
    expect(res.body.nextCursor).toBeNull()
  })

  it('reports routeCount, caseCount and activeVersion (null until deployed)', async () => {
    const w = await world()
    const p = await t.f.createProject({ workspaceId: w.ws.id })
    const r1 = await t.f.createRoute({ projectId: p.id, path: '/a' })
    await t.f.createRoute({ projectId: p.id, path: '/b' })
    await t.f.createCase({ routeId: r1.id, name: 'Extra', statusCode: 404 })
    const url = `/api/v1/projects?workspaceId=${w.ws.id}`

    const before = (await t.as(w.viewer).get(url)).body.items[0]
    expect(before).toMatchObject({ routeCount: 2, caseCount: 3, activeVersion: null })

    const dep = await t.f.createDeployment({ projectId: p.id })
    const res = await t.as(w.viewer).get(url)
    t.assertContract('projects.list', res)
    const live = res.body.items[0]
    expect(live.activeVersion).toMatchObject({ id: dep.versionId, label: dep.versionLabel })
    expect(live.activeVersion.deployedAt).toBe(new Date(dep.createdAt).toISOString())
  })

  it('pages 50, 50, 20 over 120 projects with nothing skipped or repeated', async () => {
    const w = await world()
    const ids: string[] = []
    for (let i = 0; i < 120; i++) ids.push((await t.f.createProject({ workspaceId: w.ws.id })).id)

    const seen: string[] = []
    const sizes: number[] = []
    let cursor: string | null = null
    do {
      const q: string = `/api/v1/projects?workspaceId=${w.ws.id}&limit=50${cursor ? `&cursor=${cursor}` : ''}`
      const res = await t.as(w.viewer).get(q)
      expect(res.status).toBe(200)
      sizes.push(res.body.items.length)
      seen.push(...res.body.items.map((p: { id: string }) => p.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(sizes).toEqual([50, 50, 20])
    expect(seen).toEqual(ids)
  })

  it('projects created in the same instant still page cleanly (id breaks the tie)', async () => {
    const w = await world()
    const at = new Date('2026-01-01T00:00:00.000Z')
    const made = []
    for (let i = 0; i < 5; i++) {
      made.push((await t.f.createProject({ workspaceId: w.ws.id, createdAt: at })).id)
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const res = await t
        .as(w.viewer)
        .get(`/api/v1/projects?workspaceId=${w.ws.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...res.body.items.map((p: { id: string }) => p.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
    expect(seen).toEqual([...made].sort())
  })

  it('a cursor we did not issue is 400 invalid_cursor', async () => {
    const w = await world()
    const base = `/api/v1/projects?workspaceId=${w.ws.id}`
    for (const cursor of [
      'garbage',
      Buffer.from('{"t":"nope","i":"x"}').toString('base64url'),
      Buffer.from('[]').toString('base64url'),
    ]) {
      const res = await t.as(w.viewer).get(`${base}&cursor=${cursor}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_cursor')
      // Not asserted against the registry on purpose: API-CONTRACT 1.4 promises this 400 for every
      // paginated list, but `projects.list` does not yet declare it (change requested in the PR).
    }
  })

  it('does not run per-project queries (statement count is flat as the list grows)', async () => {
    const w = await world()
    const url = `/api/v1/projects?workspaceId=${w.ws.id}&limit=50`
    let statements = 0
    const original = t.pool.query.bind(t.pool)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(t.pool as any).query = (...args: unknown[]) => {
      statements++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any)(...args)
    }
    try {
      await t.f.createProject({ workspaceId: w.ws.id })
      statements = 0
      await t.as(w.viewer).get(url)
      const few = statements

      for (let i = 0; i < 25; i++) await t.f.createProject({ workspaceId: w.ws.id })
      statements = 0
      const res = await t.as(w.viewer).get(url)
      expect(res.body.items).toHaveLength(26)
      expect(statements).toBe(few)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(t.pool as any).query = original
    }
  })
})

describe('projects.getBySlug / projects.get', () => {
  it('by-slug: a member gets 200; an outsider and an unknown slug get the identical 404', async () => {
    const w = await world()
    const slug = `by-slug-${Date.now()}`
    await t.f.createProject({ workspaceId: w.ws.id, slug })
    const ok = await t.as(w.viewer).get(`/api/v1/projects/by-slug/${slug}`)
    expect(ok.status).toBe(200)
    t.assertContract('projects.getBySlug', ok)
    expect(ok.body.slug).toBe(slug)

    const outsider = await t.as(w.outsider).get(`/api/v1/projects/by-slug/${slug}`)
    const unknown = await t.as(w.viewer).get('/api/v1/projects/by-slug/no-such-project')
    const weird = await t.as(w.viewer).get('/api/v1/projects/by-slug/Not%20A%20Slug!')
    for (const res of [outsider, unknown, weird]) {
      expect(res.status).toBe(404)
      t.assertContract('projects.getBySlug', res)
    }
    expect(outsider.body).toEqual(unknown.body)
    expect((await t.as(undefined).get(`/api/v1/projects/by-slug/${slug}`)).status).toBe(401)
  })

  it('get: viewer 200 with the full shape; outsider and a random id are 404', async () => {
    const w = await world()
    const p = await t.f.createProject({ workspaceId: w.ws.id })
    const res = await t.as(w.viewer).get(`/api/v1/projects/${p.id}`)
    expect(res.status).toBe(200)
    t.assertContract('projects.get', res)
    expect(res.body.id).toBe(p.id)
    expect((await t.as(w.outsider).get(`/api/v1/projects/${p.id}`)).status).toBe(404)
    const missing = await t
      .as(w.viewer)
      .get('/api/v1/projects/018f0000-0000-7000-8000-000000000000')
    expect(missing.status).toBe(404)
  })
})

describe('projects.delete', () => {
  it('editor 403 (project stays); outsider 404; owner 204 with every child gone and the hook fired once', async () => {
    const w = await world()
    const p = await t.f.createProject({ workspaceId: w.ws.id })
    const route = await t.f.createRoute({ projectId: p.id })
    await t.f.createPreset({ projectId: p.id })
    await t.f.createDeployment({ projectId: p.id })
    const url = `/api/v1/projects/${p.id}`

    const listener = vi.fn()
    const off = hooks.onProjectDeleted.on(listener)
    try {
      expect((await t.as(w.editor).delete(url)).status).toBe(403)
      expect((await t.as(w.outsider).delete(url)).status).toBe(404)
      expect((await t.as(w.viewer).delete(url)).status).toBe(403)
      expect(await projectCount()).toBeGreaterThan(0)
      expect((await t.as(w.owner).get(url)).status).toBe(200)
      expect(listener).not.toHaveBeenCalled()

      const res = await t.as(w.owner).delete(url)
      expect(res.status).toBe(204)
      t.assertContract('projects.delete', res)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(p.id)
    } finally {
      off()
    }

    expect((await t.as(w.owner).get(url)).status).toBe(404)
    const rows = await t.db.execute(
      sql`select (select count(*)::int from routes where project_id = ${p.id}) as routes,
                 (select count(*)::int from response_cases where route_id = ${route.id}) as cases,
                 (select count(*)::int from data_presets where project_id = ${p.id}) as presets,
                 (select count(*)::int from versions where project_id = ${p.id}) as versions,
                 (select count(*)::int from deployments where project_id = ${p.id}) as deployments`,
    )
    expect(rows.rows[0]).toEqual({ routes: 0, cases: 0, presets: 0, versions: 0, deployments: 0 })
  })

  it('deleting a missing project is 404 and fires no hook', async () => {
    const w = await world()
    const listener = vi.fn()
    const off = hooks.onProjectDeleted.on(listener)
    try {
      const res = await t
        .as(w.owner)
        .delete('/api/v1/projects/018f0000-0000-7000-8000-000000000000')
      expect(res.status).toBe(404)
      expect(listener).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })
})

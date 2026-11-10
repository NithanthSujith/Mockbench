// BLD-01 acceptance tests: the routes.* endpoints against the real app and a real Postgres.
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'
import { derivedCopyPath, listRoutes } from './service'

let app: TestApp
let owner: TestSession
let editor: TestSession
let viewer: TestSession
let outsider: TestSession
let workspaceId: string

beforeAll(async () => {
  app = await testApp()
  const ws = await app.f.createWorkspace()
  workspaceId = ws.id
  const member = async (role: 'owner' | 'editor' | 'viewer') => {
    const s = await app.session()
    await app.f.createMember({ workspaceId, userId: s.userId, role })
    return s
  }
  owner = await member('owner')
  editor = await member('editor')
  viewer = await member('viewer')
  outsider = await app.session()
})

afterAll(async () => {
  await app?.drop()
})

const newProject = () => app.f.createProject({ workspaceId })

async function post(projectId: string, body: unknown, who: TestSession = editor) {
  const res = await app
    .as(who)
    .post(app.pathFor('routes.create', { projectId }))
    .send(body as object)
  app.assertContract('routes.create', res)
  return res
}

async function routeRows(projectId: string) {
  const { rows } = await app.pool.query(
    'select id, method, path, normalized_path, sort_order from routes where project_id = $1 order by sort_order, created_at',
    [projectId],
  )
  return rows as { id: string; method: string; path: string; normalized_path: string }[]
}

describe('routes.create', () => {
  it('returns 201 with the route and its default case OK/200', async () => {
    const p = await newProject()
    const res = await post(p.id, { method: 'GET', path: '/users/:id', description: 'One user.' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      projectId: p.id,
      method: 'GET',
      path: '/users/:id',
      description: 'One user.',
      cases: [{ name: 'OK', statusCode: 200, isDefault: true }],
    })
    const { rows } = await app.pool.query(
      'select schema, headers, delay_ms, is_default from response_cases where route_id = $1',
      [res.body.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].schema).toEqual({
      version: 1,
      components: {},
      root: { type: 'object', fields: [] },
    })
    expect(rows[0].headers).toEqual({})
    expect(rows[0].delay_ms).toBeNull()
  })

  it('is atomic: when the default case cannot be inserted, no route row remains', async () => {
    const p = await newProject()
    await app.pool.query(`
      create or replace function bld01_fail_case() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end $$;
      create trigger bld01_fail_case before insert on response_cases
        for each row execute function bld01_fail_case();`)
    try {
      const res = await post(p.id, { method: 'GET', path: '/will-not-exist' })
      expect(res.status).toBe(500)
    } finally {
      await app.pool.query('drop trigger if exists bld01_fail_case on response_cases')
      await app.pool.query('drop function if exists bld01_fail_case()')
    }
    expect(await routeRows(p.id)).toEqual([])
  })

  it('rejects a colliding route with 409 route_conflict naming the existing route; creates no row', async () => {
    const p = await newProject()
    const first = await post(p.id, { method: 'GET', path: '/users/:id' })
    for (const path of ['/users/:userId', '/Users/:x', '/USERS/:id']) {
      const res = await post(p.id, { method: 'GET', path })
      expect(res.status, path).toBe(409)
      expect(res.body.error).toBe('route_conflict')
      expect(res.body.details).toEqual([{ routeId: first.body.id }])
    }
    expect(await routeRows(p.id)).toHaveLength(1)
  })

  it('allows the same path with another method, and the same path in another project', async () => {
    const p = await newProject()
    const q = await newProject()
    expect((await post(p.id, { method: 'GET', path: '/users/:id' })).status).toBe(201)
    expect((await post(p.id, { method: 'POST', path: '/users/:id' })).status).toBe(201)
    expect((await post(q.id, { method: 'GET', path: '/users/:id' })).status).toBe(201)
  })

  it('a static route and a param route at the same depth do not collide', async () => {
    const p = await newProject()
    expect((await post(p.id, { method: 'GET', path: '/users/me' })).status).toBe(201)
    expect((await post(p.id, { method: 'GET', path: '/users/:id' })).status).toBe(201)
  })

  it.each([
    ['/users/', 'trailing_slash'],
    ['//a', 'empty_segment'],
    ['users', 'missing_leading_slash'],
    ['/a/:id/:id', 'duplicate_param'],
    ['/a*', 'invalid_segment'],
  ])('rejects the invalid path %s with 422 and an issue code', async (path) => {
    const p = await newProject()
    const res = await post(p.id, { method: 'GET', path })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
    const issue = (res.body.details as { path: unknown[]; code: string }[]).find(
      (d) => d.path[0] === 'path',
    )
    expect(issue, JSON.stringify(res.body.details)).toBeDefined()
    expect(issue!.code).toEqual(expect.any(String))
    expect(await routeRows(p.id)).toEqual([])
  })

  it('rejects the method OPTIONS with 422', async () => {
    const p = await newProject()
    const res = await post(p.id, { method: 'OPTIONS', path: '/a' })
    expect(res.status).toBe(422)
    expect(await routeRows(p.id)).toEqual([])
  })

  it('two simultaneous creates of the same method and path: one 201, one 409 (race)', async () => {
    for (let i = 0; i < 8; i++) {
      const p = await newProject()
      const [a, b] = await Promise.all([
        post(p.id, { method: 'GET', path: '/race/:id' }),
        post(p.id, { method: 'GET', path: '/race/:other' }),
      ])
      expect([a.status, b.status].sort(), `iteration ${i}`).toEqual([201, 409])
      expect(await routeRows(p.id)).toHaveLength(1)
    }
  })
})

describe('routes.list', () => {
  it('returns every route in creation order with case summaries and nextCursor null', async () => {
    const p = await newProject()
    const a = await post(p.id, { method: 'GET', path: '/a' })
    const b = await post(p.id, { method: 'POST', path: '/b' })
    await app.f.createCase({
      routeId: b.body.id,
      name: 'Not found',
      statusCode: 404,
    })
    const c = await app.f.createRoute({ projectId: p.id, method: 'GET', path: '/c' })

    const res = await app.as(viewer).get(app.pathFor('routes.list', { projectId: p.id }))
    app.assertContract('routes.list', res)
    expect(res.status).toBe(200)
    expect(res.body.nextCursor).toBeNull()
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([a.body.id, b.body.id, c.id])
    expect(res.body.items[1].cases).toEqual([
      { id: expect.any(String), name: 'OK', statusCode: 200, isDefault: true },
      { id: expect.any(String), name: 'Not found', statusCode: 404, isDefault: false },
    ])
  })

  it('returns 200 routes in one response and loads them (with cases) in ONE statement', async () => {
    const p = await newProject()
    await app.pool.query(
      `insert into routes (project_id, method, path, sort_order)
       select $1, 'GET', '/r' || i, i from generate_series(1, 200) i`,
      [p.id],
    )
    await app.pool.query(
      `insert into response_cases (route_id, name, status_code, schema, is_default, sort_order)
       select id, 'OK', 200, '{"version":1,"components":{},"root":{"type":"object","fields":[]}}'::jsonb, true, 0
       from routes where project_id = $1`,
      [p.id],
    )
    const res = await app.as(viewer).get(app.pathFor('routes.list', { projectId: p.id }))
    app.assertContract('routes.list', res)
    expect(res.body.items).toHaveLength(200)
    expect(res.body.items[0].path).toBe('/r1')
    expect(res.body.items[199].path).toBe('/r200')

    let n = 0
    const counted = drizzle(app.pool, { schema, logger: { logQuery: () => void n++ } })
    expect(await listRoutes(counted, p.id)).toHaveLength(200)
    expect(n).toBe(1)
  })

  it('an empty project returns an empty list', async () => {
    const p = await newProject()
    const res = await app.as(viewer).get(app.pathFor('routes.list', { projectId: p.id }))
    expect(res.body).toEqual({ items: [], nextCursor: null })
  })
})

describe('routes.get', () => {
  it('returns the route with its case summaries', async () => {
    const p = await newProject()
    const r = await post(p.id, { method: 'GET', path: '/g' })
    const res = await app.as(viewer).get(app.pathFor('routes.get', { routeId: r.body.id }))
    app.assertContract('routes.get', res)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(r.body)
  })
})

describe('routes.update', () => {
  it('changes the path; patching onto another route path is 409; the same path is not a conflict with itself', async () => {
    const p = await newProject()
    const a = await post(p.id, { method: 'GET', path: '/users/:id' })
    const b = await post(p.id, { method: 'GET', path: '/orders/:id' })
    const patch = (id: string, body: object) =>
      app
        .as(editor)
        .patch(app.pathFor('routes.update', { routeId: id }))
        .send(body)

    let res = await patch(a.body.id, { path: '/accounts/:id' })
    app.assertContract('routes.update', res)
    expect(res.status).toBe(200)
    expect(res.body.path).toBe('/accounts/:id')

    res = await patch(b.body.id, { path: '/accounts/:accountId' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('route_conflict')
    expect(res.body.details).toEqual([{ routeId: a.body.id }])
    app.assertContract('routes.update', res)

    res = await patch(a.body.id, { path: '/Accounts/:id', description: 'renamed' })
    expect(res.status).toBe(200) // only differs by case: still itself
  })

  it('changing only the method re-checks collisions against the new method', async () => {
    const p = await newProject()
    await post(p.id, { method: 'POST', path: '/x' })
    const g = await post(p.id, { method: 'GET', path: '/x' })
    const res = await app
      .as(editor)
      .patch(app.pathFor('routes.update', { routeId: g.body.id }))
      .send({ method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('description:null clears it; method:null is 422; {} is a no-op that keeps updatedAt', async () => {
    const p = await newProject()
    const r = await post(p.id, { method: 'GET', path: '/d', description: 'something' })
    const url = app.pathFor('routes.update', { routeId: r.body.id })

    let res = await app.as(editor).patch(url).send({ description: null })
    expect(res.status).toBe(200)
    expect(res.body.description).toBeNull()

    res = await app.as(editor).patch(url).send({ method: null })
    expect(res.status).toBe(422)

    const before = (await app.as(editor).get(app.pathFor('routes.get', { routeId: r.body.id })))
      .body
    res = await app.as(editor).patch(url).send({})
    app.assertContract('routes.update', res)
    expect(res.status).toBe(200)
    expect(res.body.updatedAt).toBe(before.updatedAt)
    expect(res.body).toEqual(before)
  })

  it('rejects unknown keys and read-only keys', async () => {
    const p = await newProject()
    const r = await post(p.id, { method: 'GET', path: '/u' })
    const res = await app
      .as(editor)
      .patch(app.pathFor('routes.update', { routeId: r.body.id }))
      .send({ projectId: p.id })
    expect(res.status).toBe(422)
  })
})

describe('routes.delete', () => {
  it('returns 204 and removes the route and its cases', async () => {
    const p = await newProject()
    const r = await post(p.id, { method: 'GET', path: '/gone' })
    const res = await app.as(editor).delete(app.pathFor('routes.delete', { routeId: r.body.id }))
    app.assertContract('routes.delete', res)
    expect(res.status).toBe(204)
    expect(await routeRows(p.id)).toEqual([])
    const { rows } = await app.pool.query(
      'select count(*)::int as n from response_cases where route_id = $1',
      [r.body.id],
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('routes.duplicate', () => {
  const dup = (routeId: string, body: object = {}, who: TestSession = editor) =>
    app.as(who).post(app.pathFor('routes.duplicate', { routeId })).send(body)

  it('derives the copy path: -copy after a static segment, /copy after a param, then -copy-2', async () => {
    const p = await newProject()
    const inv = await post(p.id, { method: 'GET', path: '/invoices' })
    const user = await post(p.id, { method: 'GET', path: '/users/:id' })

    let res = await dup(inv.body.id)
    app.assertContract('routes.duplicate', res)
    expect(res.status).toBe(201)
    expect(res.body.path).toBe('/invoices-copy')
    res = await dup(inv.body.id)
    expect(res.body.path).toBe('/invoices-copy-2')
    res = await dup(inv.body.id)
    expect(res.body.path).toBe('/invoices-copy-3')

    res = await dup(user.body.id)
    expect(res.body.path).toBe('/users/:id/copy')
    res = await dup(user.body.id)
    expect(res.body.path).toBe('/users/:id/copy-2')
  })

  it('derivedCopyPath covers the root path too', () => {
    expect(derivedCopyPath('/', 1)).toBe('/copy')
    expect(derivedCopyPath('/', 2)).toBe('/copy-2')
    expect(derivedCopyPath('/a/b', 1)).toBe('/a/b-copy')
    expect(derivedCopyPath('/a/:b', 3)).toBe('/a/:b/copy-3')
  })

  it('copies every case (schema, headers, delay) and keeps exactly one default', async () => {
    const p = await newProject()
    const src = await post(p.id, { method: 'GET', path: '/things', description: 'Things.' })
    const customSchema = {
      version: 1,
      components: {},
      root: { type: 'object', fields: [{ key: 'id', node: { type: 'uuid' } }] },
    }
    await app.f.createCase({
      routeId: src.body.id,
      name: 'Not found',
      statusCode: 404,
      schema: customSchema,
      headers: { 'X-Reason': 'missing' },
      delayMs: 250,
    })
    const res = await dup(src.body.id)
    expect(res.status).toBe(201)
    expect(res.body.description).toBe('Things.')
    expect(res.body.cases.map((c: { name: string }) => c.name)).toEqual(['OK', 'Not found'])
    expect(res.body.cases.filter((c: { isDefault: boolean }) => c.isDefault)).toHaveLength(1)
    expect(res.body.cases[0].isDefault).toBe(true)

    const { rows } = await app.pool.query(
      `select name, status_code, schema, headers, delay_ms, is_default, route_id
       from response_cases where route_id = any($1) order by route_id, sort_order`,
      [[src.body.id, res.body.id]],
    )
    const bySrc = rows.filter((r: { route_id: string }) => r.route_id === src.body.id)
    const byCopy = rows.filter((r: { route_id: string }) => r.route_id === res.body.id)
    expect(byCopy).toHaveLength(2)
    const pick = (r: Record<string, unknown>) => ({
      name: r.name,
      status_code: r.status_code,
      schema: r.schema,
      headers: r.headers,
      delay_ms: r.delay_ms,
      is_default: r.is_default,
    })
    for (let i = 0; i < 2; i++) expect(pick(byCopy[i])).toEqual(pick(bySrc[i]))
    expect(byCopy[1].delay_ms).toBe(250)
    expect(byCopy[1].headers).toEqual({ 'X-Reason': 'missing' })
    // The copy gets its own case ids.
    const ids = await app.pool.query('select id from response_cases where route_id = any($1)', [
      [src.body.id, res.body.id],
    ])
    expect(new Set(ids.rows.map((r: { id: string }) => r.id)).size).toBe(4)
  })

  it('copies to an explicit path; an explicit colliding path is 409', async () => {
    const p = await newProject()
    const src = await post(p.id, { method: 'GET', path: '/src' })
    await post(p.id, { method: 'GET', path: '/taken/:id' })

    let res = await dup(src.body.id, { path: '/other' })
    expect(res.status).toBe(201)
    expect(res.body.path).toBe('/other')

    res = await dup(src.body.id, { path: '/taken/:anything' })
    app.assertContract('routes.duplicate', res)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('route_conflict')
    expect(res.body.details).toEqual([{ routeId: expect.any(String) }])

    res = await dup(src.body.id, { path: '/src' }) // the source itself
    expect(res.status).toBe(409)
  })

  it('with only a new method, the copy keeps the same path (a different route), and conflicts fall back to a derived path', async () => {
    const p = await newProject()
    const src = await post(p.id, { method: 'GET', path: '/m' })
    let res = await dup(src.body.id, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ method: 'POST', path: '/m' })
    res = await dup(src.body.id, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ method: 'POST', path: '/m-copy' })
  })

  it('a derived path that would exceed the path limit is 422, not a 500', async () => {
    const p = await newProject()
    const long = '/' + 'a'.repeat(198) // 199 chars; "-copy" pushes it over 200
    const src = await app.f.createRoute({ projectId: p.id, method: 'GET', path: long })
    const res = await dup(src.id)
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
  })
})

describe('roles and authentication (every endpoint)', () => {
  type Call = (who: TestSession | undefined, projectId: string, routeId: string) => request
  type request = ReturnType<ReturnType<TestApp['as']>['get']>
  const calls: Record<string, { min: 'viewer' | 'editor'; call: Call }> = {
    'routes.list': {
      min: 'viewer',
      call: (w, projectId) => app.as(w).get(app.pathFor('routes.list', { projectId })),
    },
    'routes.get': {
      min: 'viewer',
      call: (w, _p, routeId) => app.as(w).get(app.pathFor('routes.get', { routeId })),
    },
    'routes.create': {
      min: 'editor',
      call: (w, projectId) =>
        app
          .as(w)
          .post(app.pathFor('routes.create', { projectId }))
          .send({ method: 'GET', path: `/role-${Math.random().toString(36).slice(2)}` }),
    },
    'routes.update': {
      min: 'editor',
      call: (w, _p, routeId) =>
        app.as(w).patch(app.pathFor('routes.update', { routeId })).send({ description: 'x' }),
    },
    'routes.duplicate': {
      min: 'editor',
      call: (w, _p, routeId) =>
        app.as(w).post(app.pathFor('routes.duplicate', { routeId })).send({}),
    },
    'routes.delete': {
      min: 'editor',
      call: (w, _p, routeId) => app.as(w).delete(app.pathFor('routes.delete', { routeId })),
    },
  }

  for (const [id, { min, call }] of Object.entries(calls)) {
    it(`${id}: owner and editor allowed, viewer ${min === 'viewer' ? 'allowed' : '403'}, outsider 404, anonymous 401`, async () => {
      const p = await newProject()
      const fresh = async () => (await app.f.createRoute({ projectId: p.id })).id
      const ok = id === 'routes.create' || id === 'routes.duplicate' ? [200, 201] : [200, 204]

      for (const [name, who] of [
        ['owner', owner],
        ['editor', editor],
      ] as const) {
        const res = await call(who, p.id, await fresh())
        app.assertContract(id, res)
        expect(ok, `${id} as ${name}`).toContain(res.status)
      }

      const asViewer = await call(viewer, p.id, await fresh())
      app.assertContract(id, asViewer)
      if (min === 'viewer') expect(asViewer.status).toBe(200)
      else {
        expect(asViewer.status).toBe(403)
        expect(asViewer.body.error).toBe('forbidden')
      }

      const asOutsider = await call(outsider, p.id, await fresh())
      app.assertContract(id, asOutsider)
      expect(asOutsider.status).toBe(404)
      expect(asOutsider.body.error).toBe('not_found')

      const anon = await call(undefined, p.id, await fresh())
      app.assertContract(id, anon)
      expect(anon.status).toBe(401)
      expect(anon.body.error).toBe('unauthenticated')
    })
  }

  it('a project or route id that does not exist is 404 (same body as not-yours)', async () => {
    const missing = '019e0000-0000-7000-8000-000000000000'
    for (const res of [
      await app.as(editor).get(app.pathFor('routes.list', { projectId: missing })),
      await app.as(editor).get(app.pathFor('routes.get', { routeId: missing })),
      await app
        .as(editor)
        .post(app.pathFor('routes.create', { projectId: missing }))
        .send({ method: 'GET', path: '/x' }),
    ]) {
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('not_found')
    }
  })

  it('a route id from another workspace is 404 for a member of this one', async () => {
    const other = await app.f.createRoute()
    const res = await app.as(editor).get(app.pathFor('routes.get', { routeId: other.id }))
    expect(res.status).toBe(404)
  })
})

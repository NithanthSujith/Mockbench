// BLD-02 acceptance tests: the cases.* endpoints against the real app and a real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'

let app: TestApp
let editor: TestSession
let viewer: TestSession
let outsider: TestSession
let workspaceId: string

beforeAll(async () => {
  app = await testApp()
  workspaceId = (await app.f.createWorkspace()).id
  const member = async (role: 'owner' | 'editor' | 'viewer') => {
    const s = await app.session()
    await app.f.createMember({ workspaceId, userId: s.userId, role })
    return s
  }
  editor = await member('editor')
  viewer = await member('viewer')
  outsider = await app.session()
})

afterAll(async () => {
  await app?.drop()
})

const newRoute = async () => {
  const project = await app.f.createProject({ workspaceId })
  return app.f.createRoute({ projectId: project.id })
}

async function create(routeId: string, body: unknown, who: TestSession = editor) {
  const res = await app
    .as(who)
    .post(app.pathFor('cases.create', { routeId }))
    .send(body as object)
  app.assertContract('cases.create', res)
  return res
}

async function patch(caseId: string, body: unknown, who: TestSession = editor) {
  const res = await app
    .as(who)
    .patch(app.pathFor('cases.update', { caseId }))
    .send(body as object)
  app.assertContract('cases.update', res)
  return res
}

const defaultsOf = async (routeId: string) => {
  const { rows } = await app.pool.query(
    'select id from response_cases where route_id = $1 and is_default',
    [routeId],
  )
  return rows.map((r: { id: string }) => r.id)
}

const issueCodes = (res: { body: { details: { code: string; path: unknown[] }[] } }) =>
  res.body.details.map((d) => d.code)

describe('cases.create', () => {
  it('returns 201 with isDefault false, the empty-object schema and delayMs null', async () => {
    const route = await newRoute()
    const res = await create(route.id, { name: 'Not found', statusCode: 404 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      routeId: route.id,
      name: 'Not found',
      statusCode: 404,
      isDefault: false,
      delayMs: null,
      headers: {},
      schema: { version: 1, components: {}, root: { type: 'object', fields: [] } },
    })
  })

  it('rejects a duplicate name (case-insensitive) with 409 and no row; allows it on another route', async () => {
    const route = await newRoute()
    const other = await newRoute()
    expect((await create(route.id, { name: 'Not found', statusCode: 404 })).status).toBe(201)
    const dup = await create(route.id, { name: 'not found', statusCode: 404 })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toBe('case_name_taken')
    const { rows } = await app.pool.query('select 1 from response_cases where route_id = $1', [
      route.id,
    ])
    expect(rows).toHaveLength(2) // the factory's OK + Not found
    expect((await create(other.id, { name: 'Not found', statusCode: 404 })).status).toBe(201)
  })

  it('isDefault:true makes it the default and demotes the previous one; never zero or two defaults', async () => {
    const route = await newRoute()
    const before = await defaultsOf(route.id)
    expect(before).toHaveLength(1)

    let stop = false
    const seen = new Set<number>()
    const reader = (async () => {
      while (!stop) {
        const { rows } = await app.pool.query(
          'select count(*)::int as n from response_cases where route_id = $1 and is_default',
          [route.id],
        )
        seen.add(rows[0].n)
      }
    })()
    const made: string[] = []
    for (let i = 0; i < 8; i++) {
      const res = await create(route.id, { name: `D${i}`, statusCode: 200, isDefault: true })
      expect(res.status).toBe(201)
      expect(res.body.isDefault).toBe(true)
      made.push(res.body.id)
    }
    stop = true
    await reader
    expect([...seen]).toEqual([1])
    expect(await defaultsOf(route.id)).toEqual([made[7]])
  })

  it('accepts only whitelisted status codes and a delay of 0..10000', async () => {
    const route = await newRoute()
    expect((await create(route.id, { name: 'teapot', statusCode: 418 })).status).toBe(422)
    expect((await create(route.id, { name: 'slow', statusCode: 200, delayMs: 10001 })).status).toBe(
      422,
    )
    expect((await create(route.id, { name: 'neg', statusCode: 200, delayMs: -1 })).status).toBe(422)
    const nul = await create(route.id, { name: 'nul', statusCode: 200, delayMs: null })
    const zero = await create(route.id, { name: 'zero', statusCode: 200, delayMs: 0 })
    const max = await create(route.id, { name: 'max', statusCode: 200, delayMs: 10000 })
    expect([nul.status, zero.status, max.status]).toEqual([201, 201, 201])
    expect(nul.body.delayMs).toBeNull()
    expect(zero.body.delayMs).toBe(0)
    expect(max.body.delayMs).toBe(10000)
  })

  it.each([
    ['Content-Length', '5', 'reserved_header'],
    ['X-Mock-Foo', 'a', 'reserved_header'],
    ['Access-Control-Allow-Origin', '*', 'reserved_header'],
    ['X-Ok', 'line1\nline2', 'invalid_header_value'],
    ['bad name', 'v', 'invalid_header_name'],
  ])('header %s is rejected with %s and the header name in path', async (name, value, code) => {
    const route = await newRoute()
    const res = await create(route.id, { name: 'H', statusCode: 200, headers: { [name]: value } })
    expect(res.status).toBe(422)
    const issue = res.body.details.find((d: { code: string }) => d.code === code)
    expect(issue, JSON.stringify(res.body.details)).toBeDefined()
    expect(issue.path).toContain(name)
  })

  it('accepts a good header', async () => {
    const route = await newRoute()
    const res = await create(route.id, {
      name: 'H',
      statusCode: 200,
      headers: { 'X-Request-Id': 'abc' },
    })
    expect(res.status).toBe(201)
    expect(res.body.headers).toEqual({ 'X-Request-Id': 'abc' })
  })

  it('validates the schema against the PROJECT components (unknown_ref, then resolvable)', async () => {
    const project = await app.f.createProject({ workspaceId })
    const route = await app.f.createRoute({ projectId: project.id })
    const schema = {
      version: 1,
      components: {},
      root: { type: 'object', fields: [{ key: 'u', node: { type: 'ref', name: 'User' } }] },
    }
    const bad = await create(route.id, { name: 'Ref', statusCode: 200, schema })
    expect(bad.status).toBe(422)
    expect(issueCodes(bad)).toContain('unknown_ref')
    expect(bad.body.details[0].path[0]).toBe('schema')

    await app.pool.query('update projects set components = $2 where id = $1', [
      project.id,
      JSON.stringify({ User: { type: 'uuid' } }),
    ])
    expect((await create(route.id, { name: 'Ref', statusCode: 200, schema })).status).toBe(201)
  })

  it('rejects a schema over a limit with the schema-core code and a path into schema', async () => {
    const route = await newRoute()
    let node: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 12; i++) node = { type: 'object', fields: [{ key: 'a', node }] }
    const res = await create(route.id, {
      name: 'Deep',
      statusCode: 200,
      schema: { version: 1, components: {}, root: node },
    })
    expect(res.status).toBe(422)
    expect(issueCodes(res)).toContain('depth_exceeded')
    expect(res.body.details[0].path[0]).toBe('schema')

    const wide = {
      type: 'object',
      fields: Array.from({ length: 2001 }, (_, i) => ({ key: `k${i}`, node: { type: 'string' } })),
    }
    const res2 = await create(route.id, {
      name: 'Wide',
      statusCode: 200,
      schema: { version: 1, components: {}, root: wide },
    })
    expect(res2.status).toBe(422)
    expect(issueCodes(res2)).toContain('node_limit_exceeded')
  })

  it('preserves unknown keys (source, x-foo) inside schema nodes', async () => {
    const route = await newRoute()
    const schema = {
      version: 1,
      components: {},
      source: { from: 'importer' },
      root: {
        type: 'object',
        'x-foo': 1,
        fields: [{ key: 'a', node: { type: 'string', source: 'sample', 'x-bar': [1] } }],
      },
    }
    const res = await create(route.id, { name: 'Unknown', statusCode: 200, schema })
    expect(res.status).toBe(201)
    expect(res.body.schema.root['x-foo']).toBe(1)
    expect(res.body.schema.root.fields[0].node.source).toBe('sample')
    const got = await app.as(viewer).get(app.pathFor('cases.get', { caseId: res.body.id }))
    expect(got.body.schema.root.fields[0].node['x-bar']).toEqual([1])
  })

  it('accepts a ~600 KB schema and rejects a body over 1 MiB with 413', async () => {
    const route = await newRoute()
    const pad = 'p'.repeat(450)
    const fields = Array.from({ length: 1000 }, (_, i) => ({
      key: `field_${String(i).padStart(4, '0')}_${'k'.repeat(100)}`,
      node: { type: 'string', 'x-pad': pad },
    }))
    const schema = { version: 1, components: {}, root: { type: 'object', fields } }
    expect(JSON.stringify(schema).length).toBeGreaterThan(550_000)
    const ok = await create(route.id, { name: 'Big', statusCode: 200, schema })
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(201)

    const huge = await app
      .as(editor)
      .post(app.pathFor('cases.create', { routeId: route.id }))
      .send({ name: 'Huge', statusCode: 200, pad: 'x'.repeat(1024 * 1024 + 1) })
    expect(huge.status).toBe(413)
  })

  it('rejects unknown body keys with 422', async () => {
    const route = await newRoute()
    expect((await create(route.id, { name: 'X', statusCode: 200, nope: 1 })).status).toBe(422)
  })
})

describe('cases.update', () => {
  it('replaces the schema wholesale, clears headers with {}, and {} is a no-op', async () => {
    const route = await newRoute()
    const made = await create(route.id, {
      name: 'A',
      statusCode: 200,
      headers: { 'X-One': '1' },
      schema: {
        version: 1,
        components: {},
        root: { type: 'object', fields: [{ key: 'a', node: { type: 'string' } }] },
      },
    })
    const id = made.body.id
    const newSchema = {
      version: 1,
      components: {},
      root: { type: 'object', fields: [{ key: 'b', node: { type: 'integer' } }] },
    }
    const r1 = await patch(id, { schema: newSchema })
    expect(r1.status).toBe(200)
    expect(r1.body.schema).toEqual(newSchema)
    expect(r1.body.headers).toEqual({ 'X-One': '1' })

    const r2 = await patch(id, { headers: {} })
    expect(r2.body.headers).toEqual({})

    const r3 = await patch(id, {})
    expect(r3.status).toBe(200)
    expect(r3.body).toEqual(r2.body)
  })

  it('isDefault is read_only (422); null delay clears; bad values are 422', async () => {
    const route = await newRoute()
    const made = await create(route.id, { name: 'A', statusCode: 200, delayMs: 50 })
    const ro = await patch(made.body.id, { isDefault: true })
    expect(ro.status).toBe(422)
    expect(issueCodes(ro)).toContain('read_only')
    expect((await patch(made.body.id, { delayMs: null })).body.delayMs).toBeNull()
    expect((await patch(made.body.id, { statusCode: 418 })).status).toBe(422)
    expect((await patch(made.body.id, { headers: { 'Content-Length': '1' } })).status).toBe(422)
    expect((await patch(made.body.id, { name: null })).status).toBe(422)
  })

  it('renaming onto another case name is 409; renaming to its own name in other case is fine', async () => {
    const route = await newRoute()
    const a = await create(route.id, { name: 'A', statusCode: 200 })
    await create(route.id, { name: 'B', statusCode: 200 })
    const clash = await patch(a.body.id, { name: 'b' })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toBe('case_name_taken')
    expect((await patch(a.body.id, { name: 'a' })).status).toBe(200)
  })

  it('validates a replaced schema against the project components', async () => {
    const route = await newRoute()
    const a = await create(route.id, { name: 'A', statusCode: 200 })
    const res = await patch(a.body.id, {
      schema: {
        version: 1,
        components: {},
        root: { type: 'object', fields: [{ key: 'u', node: { type: 'ref', name: 'Nope' } }] },
      },
    })
    expect(res.status).toBe(422)
    expect(issueCodes(res)).toContain('unknown_ref')
  })
})

describe('cases.setDefault', () => {
  it('promotes, demotes the previous default, and is idempotent', async () => {
    const route = await newRoute()
    const b = await create(route.id, { name: 'B', statusCode: 200 })
    const url = app.pathFor('cases.setDefault', { caseId: b.body.id })
    for (let i = 0; i < 2; i++) {
      const res = await app.as(editor).post(url)
      expect(res.status).toBe(200)
      app.assertContract('cases.setDefault', res)
      expect(res.body.isDefault).toBe(true)
      expect(await defaultsOf(route.id)).toEqual([b.body.id])
    }
  })

  it('concurrent setDefault on two cases leaves exactly one default', async () => {
    for (let round = 0; round < 6; round++) {
      const route = await newRoute()
      const a = await create(route.id, { name: 'A', statusCode: 200 })
      const b = await create(route.id, { name: 'B', statusCode: 200 })
      const results = await Promise.all(
        [a, b, a, b].map((c) =>
          app.as(editor).post(app.pathFor('cases.setDefault', { caseId: c.body.id })),
        ),
      )
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200])
      expect(await defaultsOf(route.id)).toHaveLength(1)
    }
  })
})

describe('cases.delete', () => {
  it('deletes a non-default case (204) and refuses the default, including the only case (409)', async () => {
    const route = await newRoute()
    const extra = await create(route.id, { name: 'Extra', statusCode: 200 })
    const del = (id: string, who = editor) =>
      app.as(who).delete(app.pathFor('cases.delete', { caseId: id }))
    const ok = await del(extra.body.id)
    expect(ok.status).toBe(204)
    app.assertContract('cases.delete', ok)

    const [onlyId] = await defaultsOf(route.id)
    const refused = await del(onlyId!)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('case_is_default')
    expect(await defaultsOf(route.id)).toEqual([onlyId])
  })
})

describe('cases.list / cases.get', () => {
  it('lists by sortOrder with nextCursor null', async () => {
    const route = await newRoute()
    await create(route.id, { name: 'Second', statusCode: 404 })
    await create(route.id, { name: 'Third', statusCode: 500 })
    const res = await app.as(viewer).get(app.pathFor('cases.list', { routeId: route.id }))
    expect(res.status).toBe(200)
    app.assertContract('cases.list', res)
    expect(res.body.nextCursor).toBeNull()
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
      expect.any(String),
      'Second',
      'Third',
    ])
  })

  it('gets one case', async () => {
    const route = await newRoute()
    const made = await create(route.id, { name: 'One', statusCode: 201 })
    const res = await app.as(viewer).get(app.pathFor('cases.get', { caseId: made.body.id }))
    expect(res.status).toBe(200)
    app.assertContract('cases.get', res)
    expect(res.body).toEqual(made.body)
  })
})

describe('authorisation', () => {
  it('viewer reads but cannot create, edit, delete or set default (403)', async () => {
    const route = await newRoute()
    const made = await create(route.id, { name: 'V', statusCode: 200 })
    const id = made.body.id
    expect(
      (await app.as(viewer).get(app.pathFor('cases.list', { routeId: route.id }))).status,
    ).toBe(200)
    expect((await create(route.id, { name: 'W', statusCode: 200 }, viewer)).status).toBe(403)
    expect((await patch(id, { name: 'Z' }, viewer)).status).toBe(403)
    expect((await app.as(viewer).delete(app.pathFor('cases.delete', { caseId: id }))).status).toBe(
      403,
    )
    expect(
      (await app.as(viewer).post(app.pathFor('cases.setDefault', { caseId: id }))).status,
    ).toBe(403)
  })

  it('a non-member gets 404 everywhere, and unknown ids are 404', async () => {
    const route = await newRoute()
    const made = await create(route.id, { name: 'N', statusCode: 200 })
    const id = made.body.id
    const ghost = '0190f3a2-7b1c-7d4e-8a5b-123456789abc'
    const o = app.as(outsider)
    expect((await o.get(app.pathFor('cases.list', { routeId: route.id }))).status).toBe(404)
    expect((await create(route.id, { name: 'W', statusCode: 200 }, outsider)).status).toBe(404)
    expect((await o.get(app.pathFor('cases.get', { caseId: id }))).status).toBe(404)
    expect((await patch(id, { name: 'Z' }, outsider)).status).toBe(404)
    expect((await o.delete(app.pathFor('cases.delete', { caseId: id }))).status).toBe(404)
    expect((await o.post(app.pathFor('cases.setDefault', { caseId: id }))).status).toBe(404)
    expect((await app.as(editor).get(app.pathFor('cases.get', { caseId: ghost }))).status).toBe(404)
  })

  it('a case id from another workspace is 404 for an editor of this one', async () => {
    const other = await app.f.createWorkspace()
    const project = await app.f.createProject({ workspaceId: other.id })
    const route = await app.f.createRoute({ projectId: project.id })
    const [{ id }] = (
      await app.pool.query('select id from response_cases where route_id = $1', [route.id])
    ).rows
    expect((await app.as(editor).get(app.pathFor('cases.get', { caseId: id }))).status).toBe(404)
    expect((await patch(id, { name: 'Z' })).status).toBe(404)
  })
})

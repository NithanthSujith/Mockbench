// PRJ-06 acceptance tests: projects.export / projects.import against the real app and Postgres.
import type { ProjectExport } from '@mockbench/api-contract'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dataPresets, projects, responseCases, routes } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'
import { validateImport } from './portability'

let app: TestApp
let editor: TestSession
let viewer: TestSession
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
})

afterAll(async () => {
  await app?.drop()
})

let n = 0
const slug = () => `imp-${Date.now().toString(36)}-${n++}`

type Schema = ProjectExport['routes'][number]['cases'][number]['schema']
const envelope = (fields: { key: string; node: object }[] = []): Schema =>
  ({ version: 1, components: {}, root: { type: 'object', fields } }) as unknown as Schema

function doc(over: Partial<ProjectExport> = {}): ProjectExport {
  return {
    formatVersion: 1,
    project: {
      name: 'Shop',
      slug: slug(),
      description: 'A shop',
      settings: { indexing: 'path', mode: 'seeded', cors: '*', defaultDelayMs: 5 },
      components: {},
    },
    presets: [
      {
        name: 'Names',
        rules: [{ match: { key: 'name' }, values: ['Ada', 'Grace'] }],
        isEnabled: true,
        priority: 3,
      },
    ],
    routes: [
      {
        method: 'GET',
        path: '/items/:id',
        description: null,
        cases: [
          {
            name: 'OK',
            statusCode: 200,
            schema: envelope([{ key: 'id', node: { type: 'string' } }]),
            headers: { 'X-Thing': 'a' },
            delayMs: null,
            isDefault: true,
          },
          {
            name: 'Missing',
            statusCode: 404,
            schema: envelope(),
            headers: {},
            delayMs: 10,
            isDefault: false,
          },
        ],
      },
      { method: 'POST', path: '/items', description: 'Create', cases: [okCase()] },
    ],
    ...over,
  }
}

function okCase(over: Record<string, unknown> = {}) {
  return {
    name: 'OK',
    statusCode: 200,
    schema: envelope(),
    headers: {},
    delayMs: null,
    isDefault: true,
    ...over,
  }
}

const doImport = (body: object, who: TestSession = editor) =>
  app.as(who).post(app.pathFor('projects.import')).send(body)

const counts = async () => ({
  projects: Number((await app.db.select({ n: sql<number>`count(*)::int` }).from(projects))[0]!.n),
  routes: Number((await app.db.select({ n: sql<number>`count(*)::int` }).from(routes))[0]!.n),
  cases: Number((await app.db.select({ n: sql<number>`count(*)::int` }).from(responseCases))[0]!.n),
  presets: Number((await app.db.select({ n: sql<number>`count(*)::int` }).from(dataPresets))[0]!.n),
})

async function imported(d: ProjectExport, extra: object = {}) {
  const res = await doImport({ workspaceId, document: d, ...extra })
  expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201)
  app.assertContract('projects.import', res)
  return res.body as { id: string; slug: string }
}

const exportOf = (id: string, who: TestSession = viewer) =>
  app.as(who).get(app.pathFor('projects.export', { projectId: id }))

describe('projects.export', () => {
  it('is byte-identical twice, ordered, attachment-named and free of ids', async () => {
    const d = doc()
    const p = await imported(d)
    const a = await exportOf(p.id)
    const b = await exportOf(p.id)
    expect(a.status).toBe(200)
    app.assertContract('projects.export', a)
    expect(a.headers['content-disposition']).toBe(`attachment; filename="${p.slug}.mockbench.json"`)
    expect(a.text).toBe(b.text)
    expect(a.body).toEqual({ ...d, project: { ...d.project, slug: p.slug } })
    expect(a.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    expect(Object.keys(a.body)).toEqual(['formatVersion', 'project', 'presets', 'routes'])
    expect(a.body.routes.map((r: { path: string }) => r.path)).toEqual(['/items/:id', '/items'])
    expect(a.body.routes[0].cases.map((c: { name: string }) => c.name)).toEqual(['OK', 'Missing'])
  })

  it('is open to viewers and hidden from outsiders', async () => {
    const p = await imported(doc())
    expect((await exportOf(p.id, viewer)).status).toBe(200)
    expect((await exportOf(p.id, await app.session())).status).toBe(404)
  })
})

describe('projects.import', () => {
  it('round-trips: export -> import (slug overridden) -> export differs only in slug', async () => {
    const first = await imported(doc())
    const e1 = (await exportOf(first.id)).body as ProjectExport
    const second = await imported(e1, { slug: slug() })
    const e2 = (await exportOf(second.id)).body as ProjectExport
    expect(e2.project.slug).not.toBe(e1.project.slug)
    expect({ ...e2, project: { ...e2.project, slug: '' } }).toEqual({
      ...e1,
      project: { ...e1.project, slug: '' },
    })
  })

  it('applies slug and name overrides', async () => {
    const s = slug()
    const res = await doImport({ workspaceId, document: doc(), slug: s, name: 'Renamed' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ slug: s, name: 'Renamed', routeCount: 2, caseCount: 3 })
  })

  it('taken slug -> 409 slug_taken, nothing created; reserved -> 422 slug_reserved', async () => {
    const d = doc()
    await imported(d)
    const before = await counts()
    const taken = await doImport({ workspaceId, document: d })
    expect(taken.status).toBe(409)
    expect(taken.body.error).toBe('slug_taken')
    const reserved = await doImport({ workspaceId, document: d, slug: 'admin' })
    expect(reserved.status).toBe(422)
    expect(reserved.body.error).toBe('slug_reserved')
    expect(await counts()).toEqual(before)
  })

  const failing: [string, (d: ProjectExport) => void, string, (string | number)[]][] = [
    [
      'routes that normalise equal',
      (d) =>
        d.routes.push({
          method: 'GET',
          path: '/ITEMS/:other',
          description: null,
          cases: [okCase()],
        }),
      'route_conflict',
      ['routes', 2, 'path'],
    ],
    [
      'a forbidden header',
      (d) => (d.routes[0]!.cases[0]!.headers = { 'Content-Length': '3' }),
      'reserved_header',
      ['routes', 0, 'cases', 0, 'headers', 'Content-Length'],
    ],
    [
      'a bad route path',
      (d) => (d.routes[1]!.path = 'items'),
      'missing_leading_slash',
      ['routes', 1, 'path'],
    ],
    [
      'a bad status code',
      (d) => (d.routes[1]!.cases[0]!.statusCode = 418),
      'invalid_status_code',
      ['routes', 1, 'cases', 0, 'statusCode'],
    ],
    [
      'a duplicate case name',
      (d) => d.routes[0]!.cases.push(okCase({ name: 'ok', isDefault: false })),
      'case_name_taken',
      ['routes', 0, 'cases', 2, 'name'],
    ],
    [
      'a route without cases',
      (d) => (d.routes[1]!.cases = []),
      'route_without_cases',
      ['routes', 1, 'cases'],
    ],
    [
      'a schema ref to a missing component',
      (d) =>
        (d.routes[1]!.cases[0]!.schema = envelope([
          { key: 'a', node: { type: 'ref', name: 'Nope' } },
        ])),
      'unknown_ref',
      ['routes', 1, 'cases', 0, 'schema'],
    ],
  ]
  for (const [label, mutate, code, pathPrefix] of failing) {
    it(`${label} -> 422 import_invalid listing {path, code, message}; no rows`, async () => {
      const d = doc()
      mutate(d)
      const before = await counts()
      const res = await doImport({ workspaceId, document: d })
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422)
      expect(res.body.error).toBe('import_invalid')
      const hit = res.body.details.find((i: { code: string }) => i.code === code)
      expect(hit, JSON.stringify(res.body.details)).toBeTruthy()
      expect(hit.path.slice(0, pathPrefix.length)).toEqual(pathPrefix)
      expect(typeof hit.message).toBe('string')
      expect(await counts()).toEqual(before)
    })
  }

  it('reports one issue per problem across the document', async () => {
    const d = doc()
    d.routes[1]!.path = 'items'
    d.routes[0]!.cases[0]!.headers = { Host: 'x' }
    const issues = validateImport(d, { slug: d.project.slug, name: d.project.name })
    expect(issues.map((i) => i.code).sort()).toEqual(['missing_leading_slash', 'reserved_header'])
  })

  it('formatVersion 2 -> unsupported_format_version', () => {
    const d = { ...doc(), formatVersion: 2 } as unknown as ProjectExport
    expect(validateImport(d, { slug: 'abc', name: 'n' })).toEqual([
      expect.objectContaining({ path: ['formatVersion'], code: 'unsupported_format_version' }),
    ])
  })

  it('gives each route exactly one default case: first marked wins, none marked -> first', async () => {
    const d = doc()
    d.routes[0]!.cases = [
      okCase({ name: 'A', isDefault: false }),
      okCase({ name: 'B', isDefault: true }),
      okCase({ name: 'C', isDefault: true }),
    ]
    d.routes[1]!.cases = [
      okCase({ name: 'X', isDefault: false }),
      okCase({ name: 'Y', isDefault: false }),
    ]
    const p = await imported(d)
    const e = (await exportOf(p.id)).body as ProjectExport
    const defaults = e.routes.map((r) => r.cases.filter((c) => c.isDefault).map((c) => c.name))
    expect(defaults).toEqual([['B'], ['X']])
  })

  it('requires editor in the target workspace', async () => {
    const before = await counts()
    expect((await doImport({ workspaceId, document: doc() }, viewer)).status).toBe(403)
    expect(await counts()).toEqual(before)
  })

  it('accepts a body of exactly 10 MiB past the size gate and rejects 10 MiB + 1 with 413', async () => {
    const limit = 10 * 1024 * 1024
    const pad = (extra: number) => {
      const head = '{"x":"'
      const tail = '"}'
      return head + 'a'.repeat(limit + extra - head.length - tail.length) + tail
    }
    const send = (body: string) =>
      app
        .as(editor)
        .post(app.pathFor('projects.import'))
        .set('Content-Type', 'application/json')
        .send(body)
    const ok = await send(pad(0))
    expect(ok.status).toBe(422) // past the size gate; fails validation, not 413
    const big = await send(pad(1))
    expect(big.status).toBe(413)
  })
})

describe('import writes what it should', () => {
  it('stores presets and sort order as given', async () => {
    const d = doc()
    d.presets = [
      { name: 'low', rules: [], isEnabled: false, priority: 1 },
      { name: 'high', rules: [], isEnabled: true, priority: 9 },
      { name: 'low', rules: [], isEnabled: true, priority: 1 },
    ]
    const p = await imported(d)
    const rows = await app.db.select().from(dataPresets).where(eq(dataPresets.projectId, p.id))
    expect(rows).toHaveLength(3)
    const e = (await exportOf(p.id)).body as ProjectExport
    expect(e.presets).toEqual([d.presets[1], d.presets[0], d.presets[2]])
  })
})

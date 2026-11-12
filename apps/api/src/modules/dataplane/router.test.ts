// RUN-05: one test per acceptance criterion in docs/specs/RUN-05-dataplane-handler.md.
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEFAULT_PROJECT_SETTINGS } from '@mockbench/api-contract'
import type { ProjectSettings, Snapshot } from '@mockbench/api-contract'
import express from 'express'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createLogger } from '../../http/logger'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import type { RequestLogInput } from './request-log'
import { createDataPlaneRouter } from './router'
import { VersionCache } from './version-cache'

let t: TestApp
beforeAll(async () => {
  t = await testApp()
})
afterAll(() => t.drop())
afterEach(() => vi.restoreAllMocks())

type SnapCase = Snapshot['routes'][number]['cases'][number]
interface CaseSpec {
  id: string
  name: string
  statusCode?: number
  headers?: Record<string, string>
  delayMs?: number | null
  isDefault?: boolean
  body?: string
  schema?: SnapCase['schema']
}
interface RouteSpec {
  id: string
  method?: 'GET' | 'POST'
  path: string
  cases: CaseSpec[]
}

const emptyObject: SnapCase['schema'] = {
  version: 1,
  components: {},
  root: { type: 'object', fields: [] },
}

const DEMO_ROUTES: RouteSpec[] = [
  {
    id: 'r-users',
    path: '/users',
    cases: [
      { id: 'c-ok', name: 'OK', isDefault: true, body: '{"users":[{"id":1}]}' },
      { id: 'c-404', name: 'Not found', statusCode: 404, body: '{"error":"nope"}' },
      { id: 'c-500a', name: 'Boom', statusCode: 500, body: '{"error":"boom"}' },
      { id: 'c-500b', name: 'Boom 2', statusCode: 500, body: '{"error":"boom2"}' },
      { id: 'c-204', name: 'Empty', statusCode: 204 },
    ],
  },
  {
    id: 'r-user',
    path: '/users/:id',
    cases: [{ id: 'c-u', name: 'One', isDefault: true, body: '{"id":1}' }],
  },
]

/** A project with a live version built from hand-made snapshot rows. */
async function publish(
  o: {
    routes?: RouteSpec[]
    settings?: Partial<ProjectSettings>
    slug?: string
    label?: string
    published?: boolean
  } = {},
) {
  const ws = await t.f.createWorkspace()
  const project = await t.f.createProject({
    workspaceId: ws.id,
    ...(o.slug ? { slug: o.slug } : {}),
  })
  if (o.published === false) return { project, slug: project.slug }
  const settings = { ...DEFAULT_PROJECT_SETTINGS, ...o.settings } as ProjectSettings
  const routes = o.routes ?? DEMO_ROUTES
  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatorVersion: 1,
    project: { id: project.id, slug: project.slug, settings, components: {} },
    routes: routes.map((r) => ({
      id: r.id,
      method: r.method ?? 'GET',
      path: r.path,
      description: null,
      cases: r.cases.map((c) => ({
        id: c.id,
        name: c.name,
        statusCode: c.statusCode ?? 200,
        headers: c.headers ?? {},
        delayMs: c.delayMs ?? null,
        isDefault: c.isDefault ?? false,
        schema: c.schema ?? emptyObject,
      })),
    })),
    presets: [],
  }
  const baked =
    settings.mode === 'random'
      ? null
      : JSON.stringify(
          Object.fromEntries(
            routes.flatMap((r) => r.cases.map((c) => [`${r.id}:${c.id}`, c.body ?? '{}'])),
          ),
        )
  const v = await t.f.createVersion({
    projectId: project.id,
    snapshot,
    baked,
    bakedBytes: baked?.length ?? 0,
    ...(o.label ? { label: o.label } : {}),
  })
  await t.f.createDeployment({ projectId: project.id, versionId: v.id })
  return { project, slug: project.slug, label: v.label }
}

const get = (path: string) => request(t.app).get(path)

describe('data plane: happy path', () => {
  it('GET /mock/demo/users -> 200, baked bytes, content-type and diagnostic headers', async () => {
    const { slug, label } = await publish()
    const res = await get(`/mock/${slug}/users`)
    expect(res.status).toBe(200)
    expect(res.text).toBe('{"users":[{"id":1}]}')
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.headers['x-mock-version']).toBe(label)
    expect(res.headers['x-mock-route']).toBe('GET /users')
    expect(res.headers['x-mock-case']).toBe('OK')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers.etag).toBeUndefined()
    expect(res.headers['x-mock-error']).toBeUndefined()
  })

  it('lowercases the slug and matches params', async () => {
    const { slug } = await publish()
    const res = await get(`/mock/${slug.toUpperCase()}/USERS/42/?x=1`)
    expect(res.status).toBe(200)
    expect(res.headers['x-mock-route']).toBe('GET /users/:id')
  })

  it('after a first request warms the cache, 100 more issue zero SQL queries', async () => {
    const { slug } = await publish()
    await get(`/mock/${slug}/users`)
    const spies = [vi.spyOn(t.pool, 'query'), vi.spyOn(t.pool, 'connect')]
    for (let i = 0; i < 100; i++) {
      const res = await get(`/mock/${slug}/users`)
      expect(res.status).toBe(200)
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })
})

describe('data plane: case selection', () => {
  it('X-Mock-Case, __case, X-Mock-Status and the failure modes', async () => {
    const { slug } = await publish()
    const a = await get(`/mock/${slug}/users`).set('X-Mock-Case', 'Not found')
    expect(a.status).toBe(404)
    expect(a.headers['x-mock-case']).toBe('Not found')
    expect(a.headers['x-mock-error']).toBeUndefined() // a mocked 404 is not a mock-server error

    const b = await get(`/mock/${slug}/users?__case=not found`)
    expect(b.status).toBe(404)
    expect(b.text).toBe('{"error":"nope"}')

    const c = await get(`/mock/${slug}/users`).set('X-Mock-Status', '500')
    expect(c.status).toBe(500)
    expect(c.text).toBe('{"error":"boom"}')

    const d = await get(`/mock/${slug}/users`).set('X-Mock-Case', 'nope')
    expect(d.status).toBe(400)
    expect(d.headers['x-mock-error']).toBe('true')
    expect(d.body.error).toBe('case_not_found')
    expect(d.body.cases.map((x: { name: string }) => x.name)).toContain('Not found')

    const e = await get(`/mock/${slug}/users?__case=OK`).set('X-Mock-Case', 'nope')
    expect(e.status).toBe(400)
  })
})

describe('data plane: mock-server errors', () => {
  it('unknown slug, unpublished, unmatched path', async () => {
    const unknown = await get('/mock/no-such-project-zz/users')
    expect(unknown.status).toBe(404)
    expect(unknown.body).toMatchObject({ error: 'project_not_found', slug: 'no-such-project-zz' })
    expect(unknown.headers['x-mock-error']).toBe('true')
    expect(unknown.headers['content-type']).toMatch(/^application\/json/)

    const { slug: draftSlug } = await publish({ published: false })
    const unpub = await get(`/mock/${draftSlug}/users`)
    expect(unpub.status).toBe(503)
    expect(unpub.body.error).toBe('project_not_published')
    expect(unpub.headers['x-mock-error']).toBe('true')

    const { slug } = await publish()
    const nf = await get(`/mock/${slug}/nothing/here`)
    expect(nf.status).toBe(404)
    expect(nf.body.error).toBe('route_not_found')
    expect(nf.body.routes).toEqual([
      { method: 'GET', path: '/users' },
      { method: 'GET', path: '/users/:id' },
    ])
    expect(nf.headers['x-mock-error']).toBe('true')
  })
})

describe('data plane: delay', () => {
  it('delayMs 300 waits >= 300 ms; null uses the default; 0 never waits', async () => {
    const { slug } = await publish({
      settings: { defaultDelayMs: 500 },
      routes: [
        {
          id: 'r',
          path: '/d',
          cases: [
            { id: 'a', name: 'slow', isDefault: true, delayMs: 300 },
            { id: 'b', name: 'zero', delayMs: 0 },
            { id: 'c', name: 'inherit', delayMs: null },
          ],
        },
      ],
    })
    await get(`/mock/${slug}/d`) // warm
    let t0 = performance.now()
    await get(`/mock/${slug}/d`)
    expect(performance.now() - t0).toBeGreaterThanOrEqual(295)

    t0 = performance.now()
    await get(`/mock/${slug}/d`).set('X-Mock-Case', 'zero')
    expect(performance.now() - t0).toBeLessThan(250)

    t0 = performance.now()
    await get(`/mock/${slug}/d`).set('X-Mock-Case', 'inherit')
    expect(performance.now() - t0).toBeGreaterThanOrEqual(495)
  })

  it('uses the injected sleep with the resolved delay', async () => {
    const { slug } = await publish({ settings: { defaultDelayMs: 40 } })
    const sleeps: number[] = []
    const standalone = express()
    standalone.use(
      '/mock',
      createDataPlaneRouter({
        logger: createLogger({ logLevel: 'silent', nodeEnv: 'test' }),
        cache: makeCache(),
        sleep: async (ms) => void sleeps.push(ms),
      }),
    )
    await request(standalone).get(`/mock/${slug}/users`)
    expect(sleeps).toEqual([40])
  })
})

/** A real VersionCache over the test database (for routers built outside createApp). */
function makeCache(): VersionCache {
  return new VersionCache({ db: t.db, maxBytes: 64 * 1024 * 1024 })
}

describe('data plane: CORS and hardening', () => {
  it('OPTIONS for an unknown slug is permissive and 204', async () => {
    const res = await request(t.app)
      .options('/mock/anything-else-zz/else')
      .set('Access-Control-Request-Headers', 'x-foo, content-type')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-methods']).toBe(
      'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    )
    expect(res.headers['access-control-allow-headers']).toBe('x-foo, content-type')
    expect(res.headers['access-control-max-age']).toBe('600')
    const bare = await request(t.app).options('/mock/anything-else-zz/else')
    expect(bare.headers['access-control-allow-headers']).toBe('*')
  })

  it('cors "off": OPTIONS is bare and normal responses carry no CORS headers', async () => {
    const { slug } = await publish({ settings: { cors: 'off' } })
    const pre = await request(t.app).options(`/mock/${slug}/users`)
    expect(pre.status).toBe(204)
    expect(Object.keys(pre.headers).filter((h) => h.startsWith('access-control'))).toEqual([])
    const res = await get(`/mock/${slug}/users`)
    expect(res.status).toBe(200)
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control'))).toEqual([])
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('every response exposes X-Mock-* and the case custom headers', async () => {
    const { slug } = await publish({
      routes: [
        {
          id: 'r',
          path: '/h',
          cases: [
            {
              id: 'a',
              name: 'A',
              isDefault: true,
              headers: { 'X-Custom': '1', 'Content-Type': 'text/html' },
            },
          ],
        },
      ],
    })
    const ok = await get(`/mock/${slug}/h`)
    const expose = ok.headers['access-control-expose-headers']!
    for (const n of ['X-Mock-Version', 'X-Mock-Route', 'X-Mock-Case', 'X-Mock-Error', 'X-Custom']) {
      expect(expose).toContain(n)
    }
    expect(ok.headers['access-control-allow-origin']).toBe('*')
    expect(ok.headers['x-custom']).toBe('1')
    expect(ok.headers['content-type']).toBe('text/html')

    const err = await get(`/mock/${slug}/missing`)
    expect(err.headers['access-control-expose-headers']).toContain('X-Mock-Error')
    expect(err.headers['access-control-allow-origin']).toBe('*')
  })

  it('every response (ok, mocked, error, OPTIONS) carries nosniff and CSP sandbox', async () => {
    const { slug } = await publish()
    const responses = [
      await get(`/mock/${slug}/users`),
      await get(`/mock/${slug}/users`).set('X-Mock-Case', 'Not found'),
      await get(`/mock/${slug}/missing`),
      await get('/mock/no-such-project-zz/x'),
      await request(t.app).options(`/mock/${slug}/users`),
    ]
    for (const r of responses) {
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-security-policy']).toBe('sandbox')
    }
  })
})

describe('data plane: HEAD and 204', () => {
  it('HEAD has the GET status and headers but no body; 204 has neither body nor content-type', async () => {
    const { slug } = await publish()
    const g = await get(`/mock/${slug}/users`)
    const h = await request(t.app).head(`/mock/${slug}/users`)
    expect(h.status).toBe(200)
    expect(h.text ?? '').toBe('')
    for (const n of ['x-mock-version', 'x-mock-route', 'x-mock-case', 'content-type']) {
      expect(h.headers[n]).toBe(g.headers[n])
    }
    const e = await get(`/mock/${slug}/users`).set('X-Mock-Case', 'Empty')
    expect(e.status).toBe(204)
    expect(e.text).toBe('')
    expect(e.headers['content-type']).toBeUndefined()
    expect(e.headers['x-mock-case']).toBe('Empty')
  })
})

describe('data plane: modes', () => {
  const uuidSchema: SnapCase['schema'] = {
    version: 1,
    components: {},
    root: { type: 'object', fields: [{ key: 'id', node: { type: 'uuid' } }] },
  }
  const routes: RouteSpec[] = [
    { id: 'r', path: '/u', cases: [{ id: 'a', name: 'A', isDefault: true, schema: uuidSchema }] },
  ]

  it('random mode returns different bodies; deterministic returns identical bytes', async () => {
    const rnd = await publish({ routes, settings: { mode: 'random' } })
    const [r1, r2] = [await get(`/mock/${rnd.slug}/u`), await get(`/mock/${rnd.slug}/u`)]
    expect(r1.status).toBe(200)
    expect(r1.text).not.toBe(r2.text)

    const det = await publish({
      routes: [
        { ...routes[0]!, cases: [{ id: 'a', name: 'A', isDefault: true, body: '{"id":"x"}' }] },
      ],
    })
    const [d1, d2] = [await get(`/mock/${det.slug}/u`), await get(`/mock/${det.slug}/u`)]
    expect(d1.text).toBe(d2.text)
  })
})

describe('data plane: isolation from the control plane', () => {
  it('ignores request bodies, including invalid JSON', async () => {
    const { slug } = await publish({
      routes: [
        {
          id: 'r',
          method: 'POST',
          path: '/p',
          cases: [{ id: 'a', name: 'A', isDefault: true, body: '{"ok":true}' }],
        },
      ],
    })
    const res = await request(t.app)
      .post(`/mock/${slug}/p`)
      .set('Content-Type', 'application/json')
      .send('{ not json')
    expect(res.status).toBe(200)
    expect(res.text).toBe('{"ok":true}')
  })

  it('a throw inside the handler yields 500 mock_internal_error and the app keeps serving', async () => {
    const boom = { get: () => Promise.reject(new Error('kaput')) } as unknown as VersionCache
    const standalone = express()
    standalone.use(
      '/mock',
      createDataPlaneRouter({
        logger: createLogger({ logLevel: 'silent', nodeEnv: 'test' }),
        cache: boom,
      }),
    )
    const res = await request(standalone).get('/mock/x/y')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('mock_internal_error')
    expect(res.headers['x-mock-error']).toBe('true')
    expect(res.body.message).toBeDefined()

    // A case whose header value Node refuses: also a clean 500, no control-plane envelope.
    const { slug } = await publish({
      routes: [
        {
          id: 'r',
          path: '/bad',
          cases: [{ id: 'a', name: 'A', isDefault: true, headers: { 'X-Bad': 'a\nb' } }],
        },
      ],
    })
    const bad = await get(`/mock/${slug}/bad`)
    expect(bad.status).toBe(500)
    expect(bad.body.error).toBe('mock_internal_error')
    expect(bad.headers['x-mock-error']).toBe('true')
    expect(bad.headers['x-bad']).toBeUndefined()
    expect((await get(`/mock/${slug}/bad`)).status).toBe(500)
  })
})

describe('data plane: request log seam and concurrency', () => {
  it('calls requestLog.record after the response for known projects only, redacting secrets', async () => {
    const { slug, project } = await publish()
    const entries: RequestLogInput[] = []
    const standalone = express()
    standalone.use(
      '/mock',
      createDataPlaneRouter({
        logger: createLogger({ logLevel: 'silent', nodeEnv: 'test' }),
        cache: makeCache(),
        requestLog: { record: (e) => void entries.push(e) },
      }),
    )
    await request(standalone).get(`/mock/${slug}/users?a=1`).set('Authorization', 'Bearer s3cret')
    await request(standalone).get('/mock/no-such-project-zz/users')
    await vi.waitFor(() => expect(entries).toHaveLength(1))
    expect(entries[0]).toMatchObject({
      projectId: project.id,
      method: 'GET',
      path: '/users',
      query: { a: '1' },
      statusCode: 200,
      routePattern: 'GET /users',
      caseName: 'OK',
      mockError: null,
    })
    expect(entries[0]!.requestHeaders.authorization).toBe('[redacted]')
  })

  it('1,000 concurrent requests complete with a constant X-Mock-Version', async () => {
    const { slug, label } = await publish()
    const rejections: unknown[] = []
    const onRejection = (e: unknown) => rejections.push(e)
    process.on('unhandledRejection', onRejection)
    const server: Server = t.app.listen(0, '127.0.0.1', 2048)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    try {
      const { port } = server.address() as AddressInfo
      // 1,000 requests with 50 in flight at once (a single burst of 1,000 sockets overflows the
      // loopback accept queue on Windows, which tests the OS, not the handler).
      const versions = new Set<string | null>()
      let started = 0
      let ok = 0
      const worker = async () => {
        while (started < 1000) {
          started++
          const r = await fetch(`http://127.0.0.1:${port}/mock/${slug}/users`)
          await r.text()
          if (r.status === 200) ok++
          versions.add(r.headers.get('x-mock-version'))
        }
      }
      await Promise.all(Array.from({ length: 50 }, worker))
      expect(ok).toBe(1000)
      expect(versions).toEqual(new Set([label]))
    } finally {
      server.close()
      process.off('unhandledRejection', onRejection)
    }
    expect(rejections).toEqual([])
  })
})

// Control-plane behaviour (FND-10 acceptance criteria), through supertest against a real,
// migrated Postgres. Test-only modules bind a few handlers; everything else must be 501.
import {
  endpoints,
  exampleAuthState,
  exampleEnvelope,
  exampleProject,
  exampleRoute,
  registry,
} from '@mockbench/api-contract'
import type { EndpointDef } from '@mockbench/api-contract'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { modules } from '../modules'
import type { ModuleMap } from '../modules'
import { concretePath, makeApp } from './helpers'
import type { TestApp } from './helpers'

const CSRF = { 'X-Mockbench-Client': 'test' }
const ALL = registry.endpoints as readonly EndpointDef[]

let seenAuth: unknown = 'unset'
const testModules = {
  system: modules.system,
  test: {
    areas: ['auth', 'projects', 'routes', 'schema'],
    handlers: {
      // public endpoint that reports who the middleware saw
      'auth.login': async (ctx: { auth: unknown }) => {
        seenAuth = ctx.auth
        return { status: 200, body: exampleAuthState }
      },
      'auth.logout': async (ctx: { auth: unknown }) => {
        seenAuth = ctx.auth
        return { status: 204 }
      },
      // session endpoint
      'auth.me': async (ctx: { auth: unknown }) => {
        seenAuth = ctx.auth
        return { status: 200, body: exampleAuthState }
      },
      // body + params validation
      'projects.update': async () => ({ status: 200, body: exampleProject }),
      'projects.import': async () => ({ status: 201, body: exampleProject }),
      'projects.list': async () => ({ status: 200, body: { items: [], nextCursor: null } }),
      'schema.infer': async () => ({
        status: 200,
        body: { schema: exampleEnvelope, warnings: [] },
      }),
      // handlers that misbehave
      'routes.get': async () => {
        throw new Error('sync boom with secret detail')
      },
      'routes.list': async () => Promise.reject(new Error('async boom')),
      'routes.update': async () => ({ status: 200, body: { not: 'a route' } }),
      'routes.delete': async () => ({ status: 200, body: { oops: true } }),
    },
  },
} as unknown as ModuleMap

let t: TestApp
let cookie = ''
/** supertest agent that always sends a valid session cookie. */
const authed = () => request.agent(t.app).set('Cookie', cookie)

beforeAll(async () => {
  t = await makeApp({ modules: testModules })
  cookie = (await t.session()).cookie
})
afterAll(() => t.drop())

describe('envelope, validation and body handling', () => {
  it('an unknown path under /api/v1 is 404 not_found in the envelope', async () => {
    const res = await authed().get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: 'not_found',
      message: expect.any(String),
      details: [],
    })
  })

  it('malformed JSON is 400 invalid_json', async () => {
    const res = await authed()
      .post('/api/v1/schema/infer')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send('{"sample": ')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_json')
    expect(res.body.details).toEqual([])
  })

  it('a body with an unknown key is 422 validation_failed and details[0].path names the key', async () => {
    const res = await authed()
      .post('/api/v1/schema/infer')
      .set(CSRF)
      .send({ sample: {}, surprise: 1 })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
    expect(res.body.details[0]).toMatchObject({ path: ['surprise'], code: 'unrecognized_keys' })
  })

  it('custom contract codes reach details: a read-only key on PATCH is code read_only', async () => {
    const res = await authed()
      .patch(`/api/v1/projects/${exampleProject.id}`)
      .set(CSRF)
      .send({ slug: 'new-slug' })
    expect(res.status).toBe(422)
    expect(res.body.details).toEqual([
      expect.objectContaining({ path: ['slug'], code: 'read_only' }),
    ])
  })

  it('invalid path params and query values are 422 with params/query path prefixes', async () => {
    const bad = await authed().patch('/api/v1/projects/not-a-uuid').set(CSRF).send({})
    expect(bad.status).toBe(422)
    expect(bad.body.details[0].path).toEqual(['params', 'projectId'])

    const q = await authed().get('/api/v1/projects?limit=0')
    expect(q.status).toBe(422)
    const paths = q.body.details.map((d: { path: unknown[] }) => d.path.join('.'))
    expect(paths).toContain('query.workspaceId')
    expect(paths).toContain('query.limit')
  })

  it('a text/plain body is 415 unsupported_media_type', async () => {
    const res = await authed()
      .post('/api/v1/schema/infer')
      .set(CSRF)
      .set('Content-Type', 'text/plain')
      .send('hello')
    expect(res.status).toBe(415)
    expect(res.body.error).toBe('unsupported_media_type')
  })

  it('a body over 1 MiB is 413 payload_too_large; projects.import allows up to 10 MiB', async () => {
    const big = JSON.stringify({ sample: 'x'.repeat(1.2 * 1024 * 1024) })
    const over = await authed()
      .post('/api/v1/schema/infer')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send(big)
    expect(over.status).toBe(413)
    expect(over.body.error).toBe('payload_too_large')

    // 1.2 MiB is fine for import (it then fails validation, which proves the larger limit applied).
    const imp = await authed()
      .post('/api/v1/projects/import')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          workspaceId: exampleProject.workspaceId,
          document: { pad: 'x'.repeat(1.2 * 1024 * 1024) },
        }),
      )
    expect(imp.status).toBe(422)
  })

  it('an absent body is validated as {} (all-optional bodies pass, required fields are reported)', async () => {
    const res = await authed().post('/api/v1/schema/infer').set(CSRF)
    expect(res.status).toBe(422)
    expect(res.body.details[0].path).toEqual(['sample'])
  })

  it('a malformed percent-encoding in the path is a 422, not a crash', async () => {
    const res = await authed().get('/api/v1/projects/%E0%A4%A')
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation_failed')
  })
})

describe('CSRF guard', () => {
  it('POST without X-Mockbench-Client is 403 csrf_rejected; with it the request proceeds', async () => {
    const without = await authed().post('/api/v1/schema/infer').send({ sample: 1 })
    expect(without.status).toBe(403)
    expect(without.body.error).toBe('csrf_rejected')
    const withHeader = await authed().post('/api/v1/schema/infer').set(CSRF).send({ sample: 1 })
    expect(withHeader.status).toBe(200)
  })

  it('applies to PUT, PATCH and DELETE too, and an empty header value does not count', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      const res = await authed()[method](`/api/v1/routes/${exampleRoute.id}`)
      expect(res.status, method).toBe(403)
    }
    const empty = await authed()
      .post('/api/v1/schema/infer')
      .set('X-Mockbench-Client', ' ')
      .send({})
    expect(empty.status).toBe(403)
  })

  it('the same GET without the header succeeds (safe methods are exempt)', async () => {
    const res = await authed().get('/api/v1/healthz')
    expect(res.status).toBe(200)
  })
})

describe('501 not_implemented', () => {
  it('EVERY registry endpoint without a handler answers 501 in the envelope, even session endpoints', async () => {
    const unimplemented = ALL.filter((e) => !e.id.startsWith('system.'))
    // An empty module map: no handler is bound, whatever the teams have merged by now.
    const plain = await makeApp({ modules: {} })
    try {
      expect(unimplemented.length).toBeGreaterThanOrEqual(49)
      for (const e of unimplemented) {
        const call = request(plain.app)[e.method.toLowerCase() as 'get']
        const res = await call(`/api/v1${concretePath(e.path)}`).set(CSRF)
        expect(res.status, e.id).toBe(501)
        expect(res.body, e.id).toEqual({
          error: 'not_implemented',
          message: expect.any(String),
          details: [],
        })
      }
    } finally {
      await plain.drop()
    }
  })

  it('501 wins over validation: a body that would be invalid is still 501 for an unbound endpoint', async () => {
    const res = await authed().post('/api/v1/workspaces').set(CSRF).send({ bogus: true })
    expect(res.status).toBe(501)
  })
})

describe('request id, errors and logging', () => {
  it('echoes a valid incoming X-Request-Id, and generates one otherwise', async () => {
    const mine = await authed().get('/api/v1/healthz').set('X-Request-Id', 'abc-123_X')
    expect(mine.headers['x-request-id']).toBe('abc-123_X')
    const gen = await authed().get('/api/v1/healthz').set('X-Request-Id', 'bad id with spaces')
    expect(gen.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a handler that throws (async rejection) is 500 internal_error with no stack and ONE error line carrying the request id', async () => {
    const before = t.logs.lines.length
    const res = await authed().get(`/api/v1/projects/${exampleProject.id}/routes`)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: 'internal_error',
      message: expect.any(String),
      details: [],
    })
    expect(JSON.stringify(res.body)).not.toMatch(/async boom|stack|at /)

    const errors = t.logs.lines.slice(before).filter((l) => l.level === 50)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.requestId).toBe(res.headers['x-request-id'])
    expect(JSON.stringify(errors[0])).toContain('async boom')
  })

  it('a synchronous throw is handled the same way, without leaking its message', async () => {
    const res = await authed().get(`/api/v1/routes/${exampleRoute.id}`)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('internal_error')
    expect(JSON.stringify(res.body)).not.toContain('secret detail')
  })

  it('every request logs one info line with method, path, status and duration', async () => {
    const before = t.logs.lines.length
    const res = await authed().get('/api/v1/nope')
    const line = t.logs.lines.slice(before).find((l) => l.msg === 'request')!
    expect(line).toMatchObject({
      level: 30,
      method: 'GET',
      path: '/api/v1/nope',
      status: 404,
      requestId: res.headers['x-request-id'],
    })
    expect(typeof line.durationMs).toBe('number')
  })

  it('outside production a handler that drifts from the contract is a loud 500, not a silent lie', async () => {
    const wrongBody = await authed().patch(`/api/v1/routes/${exampleRoute.id}`).set(CSRF).send({})
    expect(wrongBody.status).toBe(500)
    const undeclared = await authed().delete(`/api/v1/routes/${exampleRoute.id}`).set(CSRF)
    expect(undeclared.status).toBe(500)
    expect(
      t.logs.lines.some((l) => String(JSON.stringify(l)).includes('does not match the contract')),
    ).toBe(true)
    expect(t.logs.lines.some((l) => String(JSON.stringify(l)).includes('does not declare'))).toBe(
      true,
    )
  })
})

describe('authentication seam (seed session middleware)', () => {
  it('a non-public endpoint without a session is 401 unauthenticated and sets no cookie', async () => {
    const res = await request(t.app).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthenticated')
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('a valid session cookie reaches the handler as ctx.auth = { userId, sessionId }', async () => {
    const s = await t.session()
    seenAuth = 'unset'
    const res = await request(t.app).get('/api/v1/auth/me').set('Cookie', s.cookie)
    expect(res.status).toBe(200)
    expect(seenAuth).toEqual({ userId: s.userId, sessionId: s.sessionId })
  })

  it('an expired session, a deactivated user and an unknown token are all 401 and clear the cookie', async () => {
    const expired = await t.session({ expired: true })
    const inactive = await t.session({ inactive: true })
    for (const cookie of [expired.cookie, inactive.cookie, 'mockbench_session=never-issued']) {
      const res = await request(t.app).get('/api/v1/auth/me').set('Cookie', cookie)
      expect(res.status, cookie).toBe(401)
      const set = String(res.headers['set-cookie'])
      expect(set).toContain('mockbench_session=;')
      expect(set).toMatch(/Max-Age=0/i)
      expect(set).toMatch(/HttpOnly/i)
      expect(set).toMatch(/SameSite=Lax/i)
      expect(set).not.toMatch(/Secure/i)
      expect(set).not.toMatch(/Domain/i)
    }
  })

  it('a public endpoint tolerates a stale cookie (no 401) and still sees no auth', async () => {
    seenAuth = 'unset'
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .set('Cookie', 'mockbench_session=stale')
      .send({ email: 'a@b.co', password: 'x' })
    expect(res.status).toBe(200)
    expect(seenAuth).toBeNull()
  })

  it('a public endpoint sees the current session when one is valid (logout needs it)', async () => {
    const s = await t.session()
    seenAuth = 'unset'
    const res = await request(t.app).post('/api/v1/auth/logout').set(CSRF).set('Cookie', s.cookie)
    expect(res.status).toBe(204)
    expect(seenAuth).toEqual({ userId: s.userId, sessionId: s.sessionId })
  })

  it('the session cookie is not read from a different cookie name, and the raw token is never stored', async () => {
    const s = await t.session()
    const token = s.cookie.split('=')[1]!
    const res = await request(t.app).get('/api/v1/auth/me').set('Cookie', `other=${token}`)
    expect(res.status).toBe(401)
    const { rows } = await (
      t.db as unknown as {
        $client: { query: (q: string, p: unknown[]) => Promise<{ rows: unknown[] }> }
      }
    ).$client.query('select count(*)::int as n from sessions where token_hash = $1', [token])
    expect((rows[0] as { n: number }).n).toBe(0)
  })
})

describe('registry-driven routing details', () => {
  it('static routes win over param routes: /projects/by-slug/:slug is not swallowed by /projects/:projectId', async () => {
    const res = await request(t.app).get('/api/v1/projects/by-slug/billing-api')
    expect(res.status).toBe(501) // projects.getBySlug is unbound, but it was MATCHED (not a 422 on :projectId)
    expect(res.body.message).toContain('projects.getBySlug')
    const imp = await authed().post('/api/v1/projects/import').set(CSRF).send({})
    expect(imp.status).toBe(422) // projects.import (bound), not projects/:projectId
  })

  it('endpoints with aliases are reachable at every alias, and health also at the root', async () => {
    for (const path of ['/healthz', '/readyz', '/api/v1/healthz', '/api/v1/readyz']) {
      const res = await request(t.app).get(path)
      expect(res.status, path).toBe(200)
    }
    expect(endpoints.system.healthz.alsoAtRoot).toBe(true)
  })

  it('HEAD works on GET endpoints', async () => {
    const res = await request(t.app).head('/api/v1/healthz')
    expect(res.status).toBe(200)
  })
})

describe('rate limiting', () => {
  it('with CONTROL_RATE_LIMIT=3 the 4th request from one session is 429 rate_limited with a numeric Retry-After; another session is unaffected', async () => {
    const limited = await makeApp({ modules: {}, env: { CONTROL_RATE_LIMIT: '3' } })
    try {
      const a = await limited.session()
      const b = await limited.session()
      const hit = () => request(limited.app).get('/api/v1/auth/me').set('Cookie', a.cookie)
      expect([(await hit()).status, (await hit()).status, (await hit()).status]).toEqual([
        501, 501, 501,
      ])
      const fourth = await hit()
      expect(fourth.status).toBe(429)
      expect(fourth.body).toEqual({
        error: 'rate_limited',
        message: expect.any(String),
        details: [],
      })
      expect(Number(fourth.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      expect(
        (await request(limited.app).get('/api/v1/auth/me').set('Cookie', b.cookie)).status,
      ).toBe(501)
    } finally {
      await limited.drop()
    }
  })

  it('unauthenticated requests are limited per client IP (X-Forwarded-For with TRUST_PROXY=1)', async () => {
    // No bound handlers: the request must reach 501 (not 401) however many teams have merged.
    const limited = await makeApp({
      env: { CONTROL_RATE_LIMIT: '2', TRUST_PROXY: '1' },
      modules: {},
    })
    try {
      const hit = (ip: string) =>
        request(limited.app).get('/api/v1/workspaces').set('X-Forwarded-For', ip)
      expect((await hit('10.0.0.1')).status).toBe(501)
      expect((await hit('10.0.0.1')).status).toBe(501)
      expect((await hit('10.0.0.1')).status).toBe(429)
      expect((await hit('10.0.0.2')).status).toBe(501)
    } finally {
      await limited.drop()
    }
  })

  it('login and register are limited per IP by LOGIN_RATE_LIMIT, independently of the control-plane limit', async () => {
    const limited = await makeApp({
      env: { LOGIN_RATE_LIMIT: '2', CONTROL_RATE_LIMIT: '1000' },
      modules: testModules,
    })
    try {
      const login = () =>
        request(limited.app)
          .post('/api/v1/auth/login')
          .set(CSRF)
          .send({ email: 'a@b.co', password: 'x' })
      expect((await login()).status).toBe(200)
      expect((await login()).status).toBe(200)
      const third = await login()
      expect(third.status).toBe(429)
      expect(third.body.error).toBe('rate_limited')
      expect(third.headers['retry-after']).toBeDefined()
      // other endpoints are not subject to the login limit
      expect((await request(limited.app).get('/api/v1/healthz')).status).toBe(200)
    } finally {
      await limited.drop()
    }
  })
})

describe('pathologically nested request bodies', () => {
  it('answer 422 depth_exceeded instead of crashing validation with a 500', async () => {
    const depth = 3000
    const deep = '['.repeat(depth) + ']'.repeat(depth)
    for (const body of [`{"sample":${deep}}`]) {
      const res = await authed()
        .post('/api/v1/schema/infer')
        .set(CSRF)
        .set('Content-Type', 'application/json')
        .send(body)
      expect(res.status).toBe(422)
      expect(res.body.error).toBe('validation_failed')
      expect(res.body.details[0]).toMatchObject({ code: 'depth_exceeded' })
    }
  })
})

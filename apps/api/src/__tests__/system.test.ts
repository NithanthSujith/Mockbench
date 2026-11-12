import { registry } from '@mockbench/api-contract'
import type { EndpointDef } from '@mockbench/api-contract'
import { toOpenApiPath } from '@mockbench/api-contract/openapi'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApp, makeUnreachableApp } from './helpers'
import type { TestApp } from './helpers'

describe('health, readiness, instance and openapi', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await makeApp()
  })
  afterAll(() => t.drop())

  it('GET /api/v1/readyz is 200 {status:"ok",db:"up"}; /readyz and /healthz behave the same at the root', async () => {
    for (const path of ['/api/v1/readyz', '/readyz']) {
      const res = await request(t.app).get(path)
      expect(res.status, path).toBe(200)
      expect(res.body, path).toEqual({ status: 'ok', db: 'up' })
    }
    for (const path of ['/api/v1/healthz', '/healthz']) {
      const res = await request(t.app).get(path)
      expect(res.status, path).toBe(200)
      expect(res.body, path).toEqual({ status: 'ok' })
    }
  })

  it('with the database unreachable readyz is 503 not_ready in the envelope, while healthz stays 200', async () => {
    const dead = makeUnreachableApp()
    try {
      for (const path of ['/api/v1/readyz', '/readyz']) {
        const res = await request(dead.app).get(path)
        expect(res.status, path).toBe(503)
        expect(res.body, path).toEqual({
          error: 'not_ready',
          message: expect.any(String),
          details: [],
        })
      }
      expect((await request(dead.app).get('/healthz')).status).toBe(200)
    } finally {
      await dead.close()
    }
  })

  it('instance: name and version, allowSignup from config, setupRequired only while zero users exist', async () => {
    const first = await request(t.app).get('/api/v1/instance')
    expect(first.status).toBe(200)
    expect(first.body).toEqual({
      name: 'Mockbench',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      allowSignup: true,
      setupRequired: true,
    })
    await t.session() // creates a user
    expect((await request(t.app).get('/api/v1/instance')).body.setupRequired).toBe(false)

    const closed = await makeApp({ env: { ALLOW_SIGNUP: 'false' } })
    try {
      expect((await request(closed.app).get('/api/v1/instance')).body.allowSignup).toBe(false)
    } finally {
      await closed.drop()
    }
  })

  it('GET /api/v1/openapi.json is generated from the registry and contains every control-plane path', async () => {
    const res = await request(t.app).get('/api/v1/openapi.json')
    expect(res.status).toBe(200)
    expect(res.body.openapi).toMatch(/^3\.1/)
    const documented = new Set(Object.keys(res.body.paths))
    const expected = (registry.endpoints as readonly EndpointDef[]).flatMap((e) =>
      [e.path, ...(e.aliases ?? [])].map(toOpenApiPath),
    )
    expect(expected.length).toBeGreaterThanOrEqual(53)
    for (const p of expected) expect(documented, p).toContain(p)
    expect([...documented].some((p) => p.startsWith('/mock'))).toBe(false)
  })

  it('system endpoints need no session and no CSRF header', async () => {
    for (const path of ['/api/v1/instance', '/api/v1/openapi.json', '/api/v1/healthz']) {
      expect((await request(t.app).get(path)).status, path).toBe(200)
    }
  })
})

describe('data plane isolation (ADR 0011)', () => {
  it('GET /mock/x/y runs NONE of the control-plane steps and answers its own 404 mock error with X-Mock-Error: true', async () => {
    const steps: string[] = []
    const t = await makeApp({ trace: (s) => steps.push(s) })
    try {
      const res = await request(t.app).get('/mock/x/y').set('Cookie', 'mockbench_session=whatever')
      expect(steps).toEqual([]) // no request-id, csrf, cookies, session, rate-limit, json-body
      expect(res.status).toBe(404)
      expect(res.headers['x-mock-error']).toBe('true')
      expect(res.body).toEqual({
        error: 'project_not_found',
        message: expect.any(String),
        hint: expect.any(String),
        slug: 'x',
      })
      // not the control-plane envelope and no control-plane artefacts
      expect(res.body.details).toBeUndefined()
      expect(res.headers['x-request-id']).toBeUndefined()
      expect(res.headers['set-cookie']).toBeUndefined()
    } finally {
      await t.drop()
    }
  })

  it('the data plane ignores request bodies entirely, including invalid JSON and any method', async () => {
    const steps: string[] = []
    const t = await makeApp({ trace: (s) => steps.push(s) })
    try {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const call = request(t.app)[method]
        const res = await call('/mock/demo/things')
          .set('Content-Type', 'application/json')
          .send('{not json')
        expect(res.status, method).toBe(404) // not 400 invalid_json, not 403 csrf_rejected
        expect(res.headers['x-mock-error']).toBe('true')
      }
      expect((await request(t.app).options('/mock/demo/things')).status).toBe(204)
      expect(steps).toEqual([])
    } finally {
      await t.drop()
    }
  })

  it('positive control: a control-plane request DOES run those steps, in order', async () => {
    const steps: string[] = []
    const t = await makeApp({ trace: (s) => steps.push(s) })
    try {
      await request(t.app).get('/api/v1/healthz')
      expect(steps.slice(0, 5)).toEqual(['request-id', 'csrf', 'cookies', 'session', 'rate-limit'])
      expect(steps).toContain('json-body')
    } finally {
      await t.drop()
    }
  })

  it('/mock is matched as a path segment prefix: /mockery is the control plane (404 envelope)', async () => {
    const t = await makeApp()
    try {
      const res = await request(t.app).get('/mockery')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('not_found')
      expect(res.headers['x-mock-error']).toBeUndefined()
    } finally {
      await t.drop()
    }
  })
})

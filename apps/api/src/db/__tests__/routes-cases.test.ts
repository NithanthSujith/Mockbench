import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECK_VIOLATION, UNIQUE_VIOLATION, testDb, pgErrorCode } from './helper'
import type { TestDb } from './helper'

describe('routes', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  it('stores normalized_path = /users/{}/orders/{} for /Users/:id/orders/:oid', async () => {
    const id = await t.make.route({ path: '/Users/:id/orders/:oid' })
    const r = await t.one<{ normalized_path: string }>(
      'SELECT normalized_path FROM routes WHERE id = $1',
      [id],
    )
    expect(r.normalized_path).toBe('/users/{}/orders/{}')
  })

  it('rejects a second GET /users/:userId/orders/:x in the same project (unique violation)', async () => {
    const project = await t.make.project()
    await t.make.route({ projectId: project, path: '/Users/:id/orders/:oid' })
    expect(
      await pgErrorCode(t.make.route({ projectId: project, path: '/users/:userId/orders/:x' })),
    ).toBe(UNIQUE_VIOLATION)
  })

  it('allows the same path with a different method, and in another project', async () => {
    const a = await t.make.project()
    const b = await t.make.project()
    await t.make.route({ projectId: a, method: 'GET', path: '/users/:id' })
    expect(await t.make.route({ projectId: a, method: 'POST', path: '/users/:id' })).toBeTruthy()
    expect(await t.make.route({ projectId: b, method: 'GET', path: '/users/:id' })).toBeTruthy()
  })

  it('does not collide static vs param segments (/users/me and /users/:id)', async () => {
    const p = await t.make.project()
    await t.make.route({ projectId: p, path: '/users/me' })
    expect(await t.make.route({ projectId: p, path: '/users/:id' })).toBeTruthy()
  })

  it('method must be one of GET POST PUT PATCH DELETE', async () => {
    for (const bad of ['OPTIONS', 'HEAD', 'get']) {
      expect(await pgErrorCode(t.make.route({ method: bad })), bad).toBe(CHECK_VIOLATION)
    }
    for (const ok of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await t.make.route({ method: ok })).toBeTruthy()
    }
  })

  it('normalized_path is generated: it cannot be written directly', async () => {
    const p = await t.make.project()
    expect(
      await pgErrorCode(
        t.q(
          `INSERT INTO routes (project_id, method, path, normalized_path) VALUES ($1, 'GET', '/a', '/b')`,
          [p],
        ),
      ),
    ).toBe('428C9')
  })

  it('updating a route path recomputes normalized_path', async () => {
    const id = await t.make.route({ path: '/a/:id' })
    await t.q("UPDATE routes SET path = '/B/:x/:y' WHERE id = $1", [id])
    const r = await t.one<{ normalized_path: string }>(
      'SELECT normalized_path FROM routes WHERE id = $1',
      [id],
    )
    expect(r.normalized_path).toBe('/b/{}/{}')
  })
})

describe('response_cases', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await testDb()
  })
  afterAll(() => t?.drop())

  it('rejects a second is_default = true case in the same route (23505)', async () => {
    const route = await t.make.route()
    await t.make.kase({ routeId: route, isDefault: true })
    expect(await pgErrorCode(t.make.kase({ routeId: route, isDefault: true }))).toBe(
      UNIQUE_VIOLATION,
    )
    expect(await t.make.kase({ routeId: route, isDefault: false })).toBeTruthy()
  })

  it('allows a default per route in different routes, and many non-default cases', async () => {
    const r1 = await t.make.route()
    const r2 = await t.make.route()
    await t.make.kase({ routeId: r1, isDefault: true })
    expect(await t.make.kase({ routeId: r2, isDefault: true })).toBeTruthy()
    await t.make.kase({ routeId: r1 })
    expect(await t.make.kase({ routeId: r1 })).toBeTruthy()
  })

  it('rejects names that differ only by case in one route, allows them across routes', async () => {
    const r1 = await t.make.route()
    const r2 = await t.make.route()
    await t.make.kase({ routeId: r1, name: 'Not found' })
    expect(await pgErrorCode(t.make.kase({ routeId: r1, name: 'NOT FOUND' }))).toBe(
      UNIQUE_VIOLATION,
    )
    expect(await t.make.kase({ routeId: r2, name: 'not found' })).toBeTruthy()
  })

  it('status_code 418 fails the check; every curated code passes', async () => {
    expect(await pgErrorCode(t.make.kase({ statusCode: 418 }))).toBe(CHECK_VIOLATION)
    expect(await pgErrorCode(t.make.kase({ statusCode: 100 }))).toBe(CHECK_VIOLATION)
    const route = await t.make.route()
    for (const code of [200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      await t.make.kase({ routeId: route, statusCode: code })
    }
  })

  it('delay_ms 10001 and -1 fail; NULL, 0 and 10000 succeed and are stored distinctly', async () => {
    expect(await pgErrorCode(t.make.kase({ delayMs: 10001 }))).toBe(CHECK_VIOLATION)
    expect(await pgErrorCode(t.make.kase({ delayMs: -1 }))).toBe(CHECK_VIOLATION)
    const route = await t.make.route()
    const nul = await t.make.kase({ routeId: route, delayMs: null })
    const zero = await t.make.kase({ routeId: route, delayMs: 0 })
    await t.make.kase({ routeId: route, delayMs: 10000 })
    const rows = await t.pool.query<{ id: string; delay_ms: number | null }>(
      'SELECT id, delay_ms FROM response_cases WHERE id = ANY($1)',
      [[nul, zero]],
    )
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.delay_ms]))
    expect(byId[nul]).toBeNull()
    expect(byId[zero]).toBe(0)
  })

  it('deleting a route cascades its cases', async () => {
    const route = await t.make.route()
    await t.make.kase({ routeId: route, isDefault: true })
    await t.q('DELETE FROM routes WHERE id = $1', [route])
    const r = await t.one<{ n: string }>(
      'SELECT count(*) AS n FROM response_cases WHERE route_id = $1',
      [route],
    )
    expect(Number(r.n)).toBe(0)
  })

  it('headers default to an empty object and schema is required', async () => {
    const route = await t.make.route()
    const id = await t.make.kase({ routeId: route })
    const r = await t.one<{ headers: unknown }>(
      'SELECT headers FROM response_cases WHERE id = $1',
      [id],
    )
    expect(r.headers).toEqual({})
    expect(
      await pgErrorCode(
        t.q("INSERT INTO response_cases (route_id, name, status_code) VALUES ($1, 'x', 200)", [
          route,
        ]),
      ),
    ).toBe('23502')
  })
})

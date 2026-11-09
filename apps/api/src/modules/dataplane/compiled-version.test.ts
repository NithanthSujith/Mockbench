// RUN-04: compileVersion, route matching and case selection. Pure: no database, no HTTP.
import type { Snapshot } from '@mockbench/api-contract'
import { describe, expect, it } from 'vitest'
import { CompileError, compileVersion } from './compiled-version'

type SnapRoute = Snapshot['routes'][number]

const EMPTY_SCHEMA: SnapRoute['cases'][number]['schema'] = {
  version: 1,
  components: {},
  root: { type: 'object', fields: [] },
}
const SETTINGS = {
  indexing: 'local' as const,
  mode: 'deterministic' as const,
  cors: '*' as const,
  defaultDelayMs: 0,
}

let seq = 0
const uid = (prefix: string) => `${prefix}-${String(++seq).padStart(6, '0')}`

interface CaseSpec {
  name: string
  status?: number
  isDefault?: boolean
}
const mkRoute = (
  method: string,
  path: string,
  cases: CaseSpec[] = [{ name: 'OK' }],
): SnapRoute => ({
  id: uid('route'),
  method: method as SnapRoute['method'],
  path,
  description: null,
  cases: cases.map((c, i) => ({
    id: uid('case'),
    name: c.name,
    statusCode: c.status ?? 200,
    headers: {},
    delayMs: null,
    isDefault: c.isDefault ?? i === 0,
    schema: EMPTY_SCHEMA,
  })),
})

const mkSnapshot = (routes: SnapRoute[]): Snapshot => ({
  schemaVersion: 1,
  generatorVersion: 1,
  project: { id: 'proj-1', slug: 'billing-api', settings: SETTINGS, components: {} },
  routes,
  presets: [],
})

/** Bakes every non-204 case as `body:<routeId>:<caseId>` so each body is distinguishable. */
const bake = (routes: SnapRoute[]): string =>
  JSON.stringify(
    Object.fromEntries(
      routes.flatMap((r) => r.cases.map((c) => [`${r.id}:${c.id}`, `body:${r.id}:${c.id}`])),
    ),
  )

const compile = (routes: SnapRoute[], opts: { baked?: string | null } = {}) =>
  compileVersion(mkSnapshot(routes), opts.baked === undefined ? bake(routes) : opts.baked, 'v3')

describe('compileVersion basics', () => {
  it('exposes label, project id, slug and settings', () => {
    const v = compile([mkRoute('GET', '/users')])
    expect(v.label).toBe('v3')
    expect(v.projectId).toBe('proj-1')
    expect(v.slug).toBe('billing-api')
    expect(v.settings).toEqual(SETTINGS)
  })
})

describe('match: static over param', () => {
  it('/users/me matches the static route over /users/:id; /users/42 matches :id with params.id === "42"', () => {
    const me = mkRoute('GET', '/users/me')
    const byId = mkRoute('GET', '/users/:id')
    const v = compile([byId, me]) // definition order must not matter
    expect(v.match('GET', '/users/me')?.route.id).toBe(me.id)
    const hit = v.match('GET', '/users/42')
    expect(hit?.route.id).toBe(byId.id)
    expect(hit?.params.id).toBe('42')
  })

  it('params are keyed by their own names, including several params and different names per route', () => {
    const a = mkRoute('GET', '/a/:x/b/:y')
    const b = mkRoute('GET', '/a/:p/c')
    const v = compile([a, b])
    expect(v.match('GET', '/a/1/b/2')?.params).toEqual({ x: '1', y: '2' })
    expect(v.match('GET', '/a/9/c')?.params).toEqual({ p: '9' })
    expect(v.match('GET', '/a/9/c')?.route.id).toBe(b.id)
  })

  it('a param called __proto__ is just a key (null-prototype params object)', () => {
    const v = compile([mkRoute('GET', '/x/:__proto__')])
    const hit = v.match('GET', '/x/abc')
    expect(hit?.params.__proto__).toBe('abc')
    expect(Object.getPrototypeOf(hit?.params)).toBeNull()
  })

  it('the root path "/" can be a route', () => {
    const root = mkRoute('GET', '/')
    const v = compile([root])
    expect(v.match('GET', '/')?.route.id).toBe(root.id)
    expect(v.match('GET', '/?x=1')?.route.id).toBe(root.id)
  })
})

describe('match: backtracking', () => {
  it('with only GET /users/:id/orders, /users/me/orders matches it (the static branch for "me" does not swallow it)', () => {
    const orders = mkRoute('GET', '/users/:id/orders')
    const v = compile([orders])
    const hit = v.match('GET', '/users/me/orders')
    expect(hit?.route.id).toBe(orders.id)
    expect(hit?.params.id).toBe('me')
  })

  it('with both /users/me and /users/:id/orders, /users/me/orders still matches the second', () => {
    const me = mkRoute('GET', '/users/me')
    const orders = mkRoute('GET', '/users/:id/orders')
    const v = compile([me, orders])
    expect(v.match('GET', '/users/me')?.route.id).toBe(me.id)
    const hit = v.match('GET', '/users/me/orders')
    expect(hit?.route.id).toBe(orders.id)
    expect(hit?.params).toEqual({ id: 'me' })
  })

  it('backtracks several levels and leaves no stale param values behind', () => {
    const deep = mkRoute('GET', '/a/b/c/:z')
    const wide = mkRoute('GET', '/a/:p/:q/d')
    const v = compile([deep, wide])
    expect(v.match('GET', '/a/b/c/9')?.params).toEqual({ z: '9' })
    // /a/b/c/d: the static chain a/b/c has a :z child, which wins (static first)...
    expect(v.match('GET', '/a/b/c/d')?.route.id).toBe(deep.id)
    // ...while /a/b/x/d fails the static branch after b and falls back to :p/:q/d.
    const hit = v.match('GET', '/a/b/x/d')
    expect(hit?.route.id).toBe(wide.id)
    expect(hit?.params).toEqual({ p: 'b', q: 'x' })
  })
})

describe('match: path tolerance', () => {
  const route = mkRoute('GET', '/users/:id')
  const v = compile([route])

  it('/Users/42/, /users/42 and /users/42?x=1 all match the same route', () => {
    for (const p of [
      '/Users/42/',
      '/users/42',
      '/users/42?x=1',
      '/USERS/42?x=1&y=2',
      '/users/42#frag',
    ]) {
      expect(v.match('GET', p)?.route.id, p).toBe(route.id)
    }
  })

  it('/users//42 and /users/42/extra do not match', () => {
    for (const p of [
      '/users//42',
      '/users/42/extra',
      '/users/42//',
      '//',
      '/users',
      '/',
      '',
      'users/42',
    ]) {
      expect(v.match('GET', p), p).toBeNull()
    }
  })

  it('param values keep their case (only static segments are case-insensitive)', () => {
    expect(v.match('GET', '/users/AbC')?.params.id).toBe('AbC')
  })
})

describe('match: methods', () => {
  const get = mkRoute('GET', '/things')
  const post = mkRoute('POST', '/things')
  const getOnly = mkRoute('GET', '/only-get')
  const v = compile([get, post, getOnly])

  it('a HEAD request matches the GET route', () => {
    expect(v.match('HEAD', '/things')?.route.id).toBe(get.id)
  })

  it('a POST to a GET-only path returns null', () => {
    expect(v.match('POST', '/only-get')).toBeNull()
    expect(v.match('POST', '/things')?.route.id).toBe(post.id)
  })

  it('the method is case-insensitive; unknown methods match nothing', () => {
    expect(v.match('get', '/things')?.route.id).toBe(get.id)
    expect(v.match('OPTIONS', '/things')).toBeNull()
    expect(v.match('TRACE', '/things')).toBeNull()
  })
})

describe('match: percent-encoding', () => {
  it('percent-encoded static segments match their decoded form', () => {
    const route = mkRoute('GET', '/users/active')
    const v = compile([route])
    expect(v.match('GET', '/us%65rs/%61ctive')?.route.id).toBe(route.id)
    expect(v.match('GET', '/%75sers/active')?.route.id).toBe(route.id)
  })

  it('param values are decoded', () => {
    const v = compile([mkRoute('GET', '/files/:name')])
    expect(v.match('GET', '/files/a%20b%2Fc')?.params.name).toBe('a b/c')
  })

  it('a malformed escape returns null without throwing', () => {
    const v = compile([mkRoute('GET', '/:a'), mkRoute('GET', '/x/:b')])
    expect(() => v.match('GET', '/%E0%A4%A')).not.toThrow()
    expect(v.match('GET', '/%E0%A4%A')).toBeNull()
    expect(v.match('GET', '/x/%zz')).toBeNull()
    expect(v.match('GET', '/x/%')).toBeNull()
  })
})

describe('selectCase', () => {
  const route = mkRoute('GET', '/users/:id', [
    { name: 'Found', status: 200 },
    { name: 'Not found', status: 404 },
    { name: 'Gone', status: 404 },
    { name: 'Server error', status: 500 },
    { name: 'Teapot', status: 418, isDefault: false },
  ])
  const v = compile([route])
  const hit = v.match('GET', '/users/1')!.route
  const [found, notFound, gone, serverError] = hit.cases

  it('with no selector the default case is returned', () => {
    expect(v.selectCase(hit, {})).toEqual({ ok: true, case: found })
  })

  it('caseHeader matches by name (trimmed, case-insensitive)', () => {
    for (const value of ['Not found', 'not found', '  NOT FOUND  ']) {
      expect(v.selectCase(hit, { caseHeader: value }), value).toEqual({ ok: true, case: notFound })
    }
  })

  it('caseHeader matches by id', () => {
    expect(v.selectCase(hit, { caseHeader: serverError!.id })).toEqual({
      ok: true,
      case: serverError,
    })
    expect(v.selectCase(hit, { caseHeader: serverError!.id.toUpperCase() })).toEqual({
      ok: true,
      case: serverError,
    })
  })

  it('caseQuery is used only when the header is absent', () => {
    expect(v.selectCase(hit, { caseQuery: 'gone' })).toEqual({ ok: true, case: gone })
    expect(v.selectCase(hit, { caseHeader: 'found', caseQuery: 'gone' })).toEqual({
      ok: true,
      case: found,
    })
  })

  it('statusHeader selects the FIRST case by sort order with that status', () => {
    expect(v.selectCase(hit, { statusHeader: '404' })).toEqual({ ok: true, case: notFound })
    expect(v.selectCase(hit, { statusHeader: ' 500 ' })).toEqual({ ok: true, case: serverError })
  })

  it('precedence: header, then query, then status, then default', () => {
    expect(
      v.selectCase(hit, { caseHeader: 'gone', caseQuery: 'found', statusHeader: '500' }),
    ).toEqual({ ok: true, case: gone })
    expect(v.selectCase(hit, { caseQuery: 'gone', statusHeader: '500' })).toEqual({
      ok: true,
      case: gone,
    })
    expect(v.selectCase(hit, { statusHeader: '500' })).toEqual({ ok: true, case: serverError })
  })

  const available = [
    { name: 'Found', statusCode: 200, isDefault: true },
    { name: 'Not found', statusCode: 404, isDefault: false },
    { name: 'Gone', statusCode: 404, isDefault: false },
    { name: 'Server error', statusCode: 500, isDefault: false },
    { name: 'Teapot', statusCode: 418, isDefault: false },
  ]

  it('a present-but-unmatched selector returns ok:false with the available cases', () => {
    expect(v.selectCase(hit, { caseHeader: 'nope' })).toEqual({ ok: false, available })
    expect(v.selectCase(hit, { caseQuery: 'nope' })).toEqual({ ok: false, available })
    expect(v.selectCase(hit, { statusHeader: '503' })).toEqual({ ok: false, available })
    expect(v.selectCase(hit, { statusHeader: 'abc' })).toEqual({ ok: false, available })
  })

  it('no fall-through: an unmatched earlier selector fails even when a later one would match', () => {
    expect(
      v.selectCase(hit, { caseHeader: 'nope', caseQuery: 'gone', statusHeader: '500' }),
    ).toEqual({
      ok: false,
      available,
    })
    expect(v.selectCase(hit, { caseQuery: 'nope', statusHeader: '500' })).toEqual({
      ok: false,
      available,
    })
  })

  it('an empty selector value is present and matches nothing', () => {
    expect(v.selectCase(hit, { caseHeader: '' }).ok).toBe(false)
    expect(v.selectCase(hit, { caseQuery: '   ' }).ok).toBe(false)
  })
})

describe('body()', () => {
  const ok = mkRoute('GET', '/users', [{ name: 'List' }, { name: 'Unauthorized', status: 401 }])
  const del = mkRoute('DELETE', '/users/:id', [{ name: 'Deleted', status: 204 }])

  it('returns the baked string for each case', () => {
    const v = compile([ok, del])
    const route = v.match('GET', '/users')!.route
    for (const [i, c] of route.cases.entries()) {
      expect(v.body(c)).toBe(`body:${ok.id}:${ok.cases[i]!.id}`)
    }
  })

  it('returns "" for a 204 case, whatever was baked for it', () => {
    const baked = JSON.stringify({
      [`${ok.id}:${ok.cases[0]!.id}`]: 'a',
      [`${ok.id}:${ok.cases[1]!.id}`]: 'b',
      [`${del.id}:${del.cases[0]!.id}`]: 'should be ignored',
    })
    const v = compile([ok, del], { baked })
    const deleted = v.match('DELETE', '/users/1')!.route.cases[0]!
    expect(v.body(deleted)).toBe('')
  })

  it('a 204 case needs no entry in the baked payload', () => {
    const baked = JSON.stringify({
      [`${ok.id}:${ok.cases[0]!.id}`]: 'a',
      [`${ok.id}:${ok.cases[1]!.id}`]: 'b',
    })
    expect(() => compile([ok, del], { baked })).not.toThrow()
  })

  it('returns null for every non-204 case when baked is null (random mode), and "" for 204', () => {
    const v = compile([ok, del], { baked: null })
    for (const c of v.match('GET', '/users')!.route.cases) expect(v.body(c)).toBeNull()
    expect(v.body(v.match('DELETE', '/users/1')!.route.cases[0]!)).toBe('')
  })

  it('keeps the case schema so random mode can generate per request', () => {
    const v = compile([ok], { baked: null })
    expect(v.match('GET', '/users')!.route.cases[0]!.schema).toEqual(EMPTY_SCHEMA)
  })
})

describe('routes()', () => {
  it('lists every {method, path} in the snapshot order', () => {
    const list = [
      mkRoute('POST', '/z'),
      mkRoute('GET', '/a/:id'),
      mkRoute('GET', '/'),
      mkRoute('DELETE', '/a/:id'),
    ]
    expect(compile(list).routes()).toEqual([
      { method: 'POST', path: '/z' },
      { method: 'GET', path: '/a/:id' },
      { method: 'GET', path: '/' },
      { method: 'DELETE', path: '/a/:id' },
    ])
  })

  it('returns copies, so a caller cannot corrupt the version', () => {
    const v = compile([mkRoute('GET', '/a')])
    v.routes()[0]!.path = '/mutated'
    expect(v.routes()[0]!.path).toBe('/a')
  })
})

describe('bytes', () => {
  it('is at least the length of the baked text, and grows with it', () => {
    const small = [mkRoute('GET', '/a')]
    const bakedSmall = bake(small)
    const vSmall = compile(small, { baked: bakedSmall })
    expect(vSmall.bytes).toBeGreaterThanOrEqual(bakedSmall.length)

    const bakedBig = JSON.stringify({
      [`${small[0]!.id}:${small[0]!.cases[0]!.id}`]: 'x'.repeat(100_000),
    })
    const vBig = compile(small, { baked: bakedBig })
    expect(vBig.bytes).toBeGreaterThanOrEqual(bakedBig.length)
    expect(vBig.bytes).toBeGreaterThan(vSmall.bytes)
  })

  it('is positive for a random-mode version and includes a caller-supplied snapshot size', () => {
    const routes = [mkRoute('GET', '/a')]
    const base = compile(routes, { baked: null })
    expect(base.bytes).toBeGreaterThan(0)
    const withHint = compileVersion(mkSnapshot(routes), null, 'v1', { snapshotBytes: 5_000 })
    expect(withHint.bytes).toBe(compileVersion(mkSnapshot(routes), null, 'v1').bytes + 5_000)
  })
})

describe('compile errors (a snapshot RUN-01 could not have produced)', () => {
  it('rejects an invalid payload', () => {
    const routes = [mkRoute('GET', '/a')]
    expect(() => compile(routes, { baked: 'not json' })).toThrow(CompileError)
    expect(() => compile(routes, { baked: '[]' })).toThrow(CompileError)
    expect(() => compile(routes, { baked: '{}' })).toThrow(/no body for case/)
  })

  it('rejects an invalid path, a route with no cases and colliding routes', () => {
    expect(() => compile([mkRoute('GET', '/a/')])).toThrow(CompileError)
    expect(() => compile([mkRoute('GET', '/a', [])])).toThrow(/no cases/)
    expect(() => compile([mkRoute('GET', '/Users/:id'), mkRoute('GET', '/users/:userId')])).toThrow(
      /collide/,
    )
  })

  it('allows the same path under different methods', () => {
    expect(() => compile([mkRoute('GET', '/a'), mkRoute('POST', '/a')])).not.toThrow()
  })
})

describe('performance budgets (generous)', () => {
  const routes: SnapRoute[] = []
  for (let i = 0; i < 500; i++) {
    routes.push(
      mkRoute(i % 5 === 0 ? 'POST' : 'GET', `/api/r${i % 50}/items${i}/:id`, [
        { name: 'OK' },
        { name: 'Not found', status: 404 },
        { name: 'Error', status: 500 },
      ]),
    )
  }

  it('compiles a 500-route, 1,500-case snapshot in under 100 ms', () => {
    const snapshot = mkSnapshot(routes)
    const baked = bake(routes)
    const start = performance.now()
    const v = compileVersion(snapshot, baked, 'v1')
    const ms = performance.now() - start
    expect(v.routes()).toHaveLength(500)
    expect(ms).toBeLessThan(100)
  })

  it('does 100,000 matches in under 150 ms', () => {
    const v = compile(routes)
    const paths = routes.map((r) => r.path.replace('/:id', '/77'))
    // Warm up the JIT, as a long-running server would be.
    for (let i = 0; i < 5_000; i++) v.match('GET', paths[i % paths.length]!)
    let hits = 0
    const start = performance.now()
    for (let i = 0; i < 100_000; i++) {
      const idx = i % paths.length
      if (v.match(routes[idx]!.method, paths[idx]!)) hits++
    }
    const ms = performance.now() - start
    expect(hits).toBe(100_000)
    expect(ms).toBeLessThan(150)
  })
})

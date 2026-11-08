import { describe, expect, it } from 'vitest'
import { normalizePath, parseRoutePath } from '../src/index'

describe('normalizePath', () => {
  it('lowercases static segments and replaces every :param with {}', () => {
    expect(normalizePath('/Users/:id/orders/:oid')).toBe('/users/{}/orders/{}')
  })
  it('makes /users/:id and /users/:userId equal, and distinguishes static from param', () => {
    expect(normalizePath('/users/:id')).toBe(normalizePath('/users/:userId'))
    expect(normalizePath('/users/me')).not.toBe(normalizePath('/users/:id'))
    expect(normalizePath('/Users/:x')).toBe('/users/{}')
  })
  it('keeps the root path as /', () => {
    expect(normalizePath('/')).toBe('/')
  })
})

describe('parseRoutePath', () => {
  const rejected: [string, string][] = [
    ['/users/', 'trailing_slash'],
    ['//a', 'empty_segment'],
    ['a', 'missing_leading_slash'],
    ['/a b', 'invalid_static_segment'],
    ['/a/:1x', 'invalid_param_name'],
    ['/a/:id/:id', 'duplicate_param'],
    ['/a*', 'wildcard_not_allowed'],
    ['/a?x=1', 'query_or_fragment_not_allowed'],
    [`/${'a'.repeat(200)}`, 'path_too_long'],
  ]
  it.each(rejected)('rejects %j with issue code %s', (path, code) => {
    const r = parseRoutePath(path)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.code).toBe(code)
  })
  it('gives each rejected example a DISTINCT issue code', () => {
    const codes = rejected.map(([p]) => {
      const r = parseRoutePath(p)
      return r.ok ? 'ok' : r.issues[0]?.code
    })
    expect(new Set(codes).size).toBe(rejected.length)
  })
  it('rejects a 201-character path and accepts 200', () => {
    expect(parseRoutePath(`/${'a'.repeat(200)}`).ok).toBe(false)
    expect(parseRoutePath(`/${'a'.repeat(199)}`).ok).toBe(true)
  })
  it('rejects a fragment and parameter names over 40 characters', () => {
    expect(parseRoutePath('/a#b').ok).toBe(false)
    expect(parseRoutePath(`/:${'p'.repeat(41)}`).ok).toBe(false)
    expect(parseRoutePath(`/:${'p'.repeat(40)}`).ok).toBe(true)
    expect(parseRoutePath('/:').ok).toBe(false)
  })
  it('accepts /, /users, /users/me and /v1/users/:id/orders/:orderId with parsed segments', () => {
    expect(parseRoutePath('/')).toEqual({ ok: true, segments: [] })
    expect(parseRoutePath('/users')).toEqual({ ok: true, segments: [{ static: 'users' }] })
    expect(parseRoutePath('/users/me').ok).toBe(true)
    expect(parseRoutePath('/v1/users/:id/orders/:orderId')).toEqual({
      ok: true,
      segments: [
        { static: 'v1' },
        { static: 'users' },
        { param: 'id' },
        { static: 'orders' },
        { param: 'orderId' },
      ],
    })
  })
  it('allows . _ ~ - in static segments and _ in param names', () => {
    expect(parseRoutePath('/api.v1/some_thing~x-y/:user_id').ok).toBe(true)
    expect(parseRoutePath('/:_x').ok).toBe(true)
  })
})

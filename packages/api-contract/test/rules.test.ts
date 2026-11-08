import { describe, expect, it } from 'vitest'
import {
  CASE_STATUS_CODES,
  CaseHeaders,
  CaseName,
  CaseStatusCodeField,
  ComponentName,
  Components,
  RESERVED_SLUGS,
  Slug,
  WorkspaceSlug,
  isReservedSlug,
  toValidationIssues,
  validateCaseHeaders,
} from '../src/index'

describe('validateCaseHeaders', () => {
  const codeOf = (h: Record<string, string>) => validateCaseHeaders(h).map((i) => i.code)

  it('rejects the forbidden names with reserved_header, case-insensitively', () => {
    for (const name of [
      'Content-Length',
      'content-length',
      'X-Mock-Foo',
      'x-mock-case',
      'access-control-allow-origin',
      'Proxy-Authorization',
      'Transfer-Encoding',
      'Connection',
      'Keep-Alive',
      'Upgrade',
      'Host',
      'TE',
      'Trailer',
    ]) {
      expect(codeOf({ [name]: 'x' })).toEqual(['reserved_header'])
    }
  })
  it('rejects a value containing a line break', () => {
    expect(codeOf({ 'X-Note': 'a\nb' })).toEqual(['invalid_header_value'])
    expect(codeOf({ 'X-Note': 'a\r\nSet-Cookie: x' })).toEqual(['invalid_header_value'])
  })
  it('rejects 21 entries and accepts 20', () => {
    const many = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`X-H${i}`, 'v']))
    expect(codeOf(many(21))).toContain('too_many_headers')
    expect(validateCaseHeaders(many(20))).toEqual([])
  })
  it('rejects bad names and over-long values with their own codes', () => {
    expect(codeOf({ 'Bad Name': 'v' })).toEqual(['invalid_header_name'])
    expect(codeOf({ 'X-Long': 'v'.repeat(1001) })).toEqual(['header_value_too_long'])
    expect(validateCaseHeaders({ 'X-Long': 'v'.repeat(1000) })).toEqual([])
  })
  it('accepts Cache-Control, X-Request-Id and Content-Type', () => {
    expect(
      validateCaseHeaders({
        'Cache-Control': 'no-store',
        'X-Request-Id': 'abc-123',
        'Content-Type': 'text/plain',
      }),
    ).toEqual([])
  })
  it('the CaseHeaders schema reports the same codes through toValidationIssues', () => {
    const r = CaseHeaders.safeParse({ 'X-Mock-Foo': 'x' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(toValidationIssues(r.error)).toEqual([
        expect.objectContaining({ path: ['X-Mock-Foo'], code: 'reserved_header' }),
      ])
    }
  })
})

describe('slugs', () => {
  it('isReservedSlug is true for exactly the six reserved slugs', () => {
    for (const s of ['api', 'mock', 'health', 'static', 'assets', 'admin']) {
      expect(isReservedSlug(s)).toBe(true)
    }
    expect([...RESERVED_SLUGS].sort()).toEqual([
      'admin',
      'api',
      'assets',
      'health',
      'mock',
      'static',
    ])
    expect(isReservedSlug('billing-api')).toBe(false)
    expect(isReservedSlug('demo')).toBe(false)
  })
  it('Slug rejects Api, ab, a_b, -a, a--b and 41 characters; accepts a-b and 40 characters', () => {
    for (const bad of ['Api', 'ab', 'a_b', '-a', 'a--b', 'a'.repeat(41), 'a-', '']) {
      expect(Slug.safeParse(bad).success).toBe(false)
    }
    for (const good of ['a-b', 'abc', 'billing-api', 'a'.repeat(40), 'v2-api']) {
      expect(Slug.safeParse(good).success).toBe(true)
    }
  })
  it('Slug does not reject reserved words (that is the slug_reserved handler error)', () => {
    expect(Slug.safeParse('api').success).toBe(true)
  })
  it('WorkspaceSlug allows 2 characters and has no reserved list', () => {
    expect(WorkspaceSlug.safeParse('ab').success).toBe(true)
    expect(WorkspaceSlug.safeParse('a').success).toBe(false)
    expect(WorkspaceSlug.safeParse('api').success).toBe(true)
  })
})

describe('case fields', () => {
  it('CASE_STATUS_CODES is exactly the 14 curated codes', () => {
    expect([...CASE_STATUS_CODES]).toEqual([
      200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503,
    ])
    for (const c of CASE_STATUS_CODES) expect(CaseStatusCodeField.safeParse(c).success).toBe(true)
    for (const c of [418, 199, 600, 200.5]) {
      expect(CaseStatusCodeField.safeParse(c).success).toBe(false)
    }
  })
  it('CaseName trims, enforces 1-60 chars and rejects control characters', () => {
    expect(CaseName.parse('  Not found  ')).toBe('Not found')
    expect(CaseName.safeParse('   ').success).toBe(false)
    expect(CaseName.safeParse('x'.repeat(61)).success).toBe(false)
    expect(CaseName.safeParse('x'.repeat(60)).success).toBe(true)
    const r = CaseName.safeParse('bad\u0007name')
    expect(r.success).toBe(false)
    if (!r.success) expect(toValidationIssues(r.error)[0]?.code).toBe('invalid_case_name')
  })
})

describe('components', () => {
  it('names start with a letter and allow letters, digits and underscore up to 64', () => {
    for (const ok of ['User', 'user_v2', 'A', 'a'.repeat(64)]) {
      expect(ComponentName.safeParse(ok).success).toBe(true)
    }
    for (const bad of ['1User', '_x', 'has-dash', 'has space', 'a'.repeat(65), '']) {
      expect(ComponentName.safeParse(bad).success).toBe(false)
    }
  })
  it('allows at most 100 components', () => {
    const make = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`C${i}`, { type: 'string' }]))
    expect(Components.safeParse(make(100)).success).toBe(true)
    expect(Components.safeParse(make(101)).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ErrorEnvelope,
  GLOBAL_ERRORS,
  Id,
  PageQuery,
  Slug,
  Timestamp,
  ValidationIssue,
  WorkspaceSlug,
  paginated,
} from '../src/index'

describe('ErrorEnvelope', () => {
  it('accepts {error, message, details: []}', () => {
    expect(ErrorEnvelope.safeParse({ error: 'x', message: 'y', details: [] }).success).toBe(true)
  })
  it('rejects a missing details', () => {
    expect(ErrorEnvelope.safeParse({ error: 'x', message: 'y' }).success).toBe(false)
  })
  it('rejects details that is an object', () => {
    expect(ErrorEnvelope.safeParse({ error: 'x', message: 'y', details: {} }).success).toBe(false)
  })
  it('rejects a non snake_case code and unknown keys', () => {
    expect(ErrorEnvelope.safeParse({ error: 'Bad-Code', message: 'y', details: [] }).success).toBe(
      false,
    )
    expect(
      ErrorEnvelope.safeParse({ error: 'x', message: 'y', details: [], extra: 1 }).success,
    ).toBe(false)
  })
  it('lets details carry validation issues', () => {
    const issue = { path: ['body', 'name', 0], code: 'too_small', message: 'required' }
    expect(ValidationIssue.safeParse(issue).success).toBe(true)
    expect(
      ErrorEnvelope.safeParse({ error: 'validation_failed', message: 'm', details: [issue] })
        .success,
    ).toBe(true)
  })
})

describe('paginated()', () => {
  const Page = paginated(z.strictObject({ n: z.number() }))
  it('accepts a page with nextCursor null or a string', () => {
    expect(Page.safeParse({ items: [{ n: 1 }], nextCursor: null }).success).toBe(true)
    expect(Page.safeParse({ items: [], nextCursor: 'abc' }).success).toBe(true)
  })
  it('rejects nextCursor: 5, a missing nextCursor and bad items', () => {
    expect(Page.safeParse({ items: [], nextCursor: 5 }).success).toBe(false)
    expect(Page.safeParse({ items: [] }).success).toBe(false)
    expect(Page.safeParse({ items: [{ n: 'x' }], nextCursor: null }).success).toBe(false)
  })
})

describe('PageQuery', () => {
  it('defaults limit to 50 and coerces query-string numbers', () => {
    expect(PageQuery.parse({})).toEqual({ limit: 50 })
    expect(PageQuery.parse({ limit: '25', cursor: 'c' })).toEqual({ limit: 25, cursor: 'c' })
  })
  it('rejects limit 0, 201 and non-integers', () => {
    for (const limit of ['0', '201', '1.5', 'abc'])
      expect(PageQuery.safeParse({ limit }).success).toBe(false)
  })
})

describe('Id, Timestamp, Slug', () => {
  it('Id accepts a UUID v7 and rejects other strings', () => {
    expect(Id.safeParse('0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b').success).toBe(true)
    expect(Id.safeParse('not-a-uuid').success).toBe(false)
  })
  it('Timestamp requires ms precision and a Z', () => {
    expect(Timestamp.safeParse('2026-11-05T08:30:00.000Z').success).toBe(true)
    for (const bad of ['2026-11-05', '2026-11-05T08:30:00Z', '2026-11-05T08:30:00.000+05:30'])
      expect(Timestamp.safeParse(bad).success).toBe(false)
  })
  it('Slug matches the project rules (3-40, no leading/double hyphen)', () => {
    for (const ok of ['abc', 'billing-api', 'a1-b2-c3'])
      expect(Slug.safeParse(ok).success).toBe(true)
    for (const bad of ['ab', 'Api', 'a_b', '-a', 'a--b', 'a'.repeat(41)])
      expect(Slug.safeParse(bad).success).toBe(false)
  })
  it('WorkspaceSlug allows 2 characters', () => {
    expect(WorkspaceSlug.safeParse('ab').success).toBe(true)
    expect(WorkspaceSlug.safeParse('a').success).toBe(false)
  })
})

describe('GLOBAL_ERRORS', () => {
  it('lists the eight global codes from API-CONTRACT 1.3', () => {
    expect(GLOBAL_ERRORS.map((e) => `${e.status} ${e.code}`)).toEqual([
      '400 invalid_json',
      '403 csrf_rejected',
      '413 payload_too_large',
      '415 unsupported_media_type',
      '422 validation_failed',
      '429 rate_limited',
      '500 internal_error',
      '501 not_implemented',
    ])
  })
})
